package com.app.modules.credit.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.dto.CreatePricingVersionRequest;
import com.app.modules.credit.dto.CreatePricingVersionResponse;
import com.app.modules.credit.dto.PricingCoverageItem;
import com.app.modules.credit.dto.PricingCoverageItem.MatchedBy;
import com.app.modules.credit.dto.PricingCoverageTarget;
import com.app.modules.credit.dto.PricingPreviewRequest;
import com.app.modules.credit.dto.PricingPreviewResponse;
import com.app.modules.credit.dto.PricingVersionResponse;
import com.app.modules.credit.entity.CreditPricingConfig;
import com.app.modules.credit.repository.CreditPricingConfigRepository;
import com.app.modules.credit.service.CreditPricingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class CreditPricingServiceImpl implements CreditPricingService {

    private static final Logger log = LoggerFactory.getLogger(CreditPricingServiceImpl.class);

    /** Capabilities allowed by the credit_pricing_config CHECK constraint (V1). */
    static final Set<String> CAPABILITIES = Set.of("STT", "TRANSLATE", "TTS", "SUMMARIZE_SCRIPT", "RENDER", "VISION");

    /** Billing units per minute of video (Credit_Coefficient_Calculation §6.3) — preview only. */
    static final Map<String, Long> UNITS_PER_MINUTE = Map.of(
            "STT", 60L,
            "TRANSLATE", 500L,
            "SUMMARIZE_SCRIPT", 500L,
            "TTS", 1000L,
            "VISION", 1000L,
            "RENDER", 60L);

    /** Capabilities the pipeline charges per job type (RENDER is not charged yet). */
    private static final Map<String, List<String>> JOB_TYPES = jobTypes();

    /** ±50% vs the version being replaced requires explicit confirmation (§10.3). */
    private static final BigDecimal LARGE_CHANGE_RATIO = new BigDecimal("0.5");
    /** Clock skew allowed for "now" sent by the browser; anything older is back-dating. */
    private static final Duration BACKDATE_TOLERANCE = Duration.ofMinutes(2);
    private static final Duration MAX_SCHEDULE_AHEAD = Duration.ofDays(366);

    private static final Pattern SCOPE = Pattern.compile("^[a-z0-9][a-z0-9_.-]*(/\\S+)?$");

    static final String WARN_DEFAULT_BELOW_SCOPED = "DEFAULT_Y_BELOW_SCOPED_MAX";
    static final String WARN_NO_DEFAULT_ROW = "NO_DEFAULT_ROW";

    private final CreditPricingConfigRepository repository;

    public CreditPricingServiceImpl(CreditPricingConfigRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<PricingVersionResponse> listCurrent() {
        Instant now = Instant.now();
        return repository.findCurrentAndScheduled(now).stream()
                .map(c -> PricingVersionResponse.from(c, now))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<PricingVersionResponse> history(String capability, String providerScope, boolean anyScope) {
        Instant now = Instant.now();
        String cap = capability == null || capability.isBlank() ? null : requireCapability(capability);
        String scope = normalizeScope(providerScope);
        return repository.findHistory(cap, scope, anyScope).stream()
                .map(c -> PricingVersionResponse.from(c, now))
                .toList();
    }

    @Override
    @Transactional
    public CreatePricingVersionResponse createVersion(UUID adminUserId, CreatePricingVersionRequest request) {
        String capability = requireCapability(request.capability());
        String scope = normalizeScope(request.providerScope());
        BigDecimal x = coefficient(request.infraCoefficientX());
        BigDecimal y = coefficient(request.tokenCoefficientY());
        String reason = request.changeReason() == null ? "" : request.changeReason().trim();
        if (reason.isEmpty()) {
            throw new AppException(ErrorCode.PRICING_INVALID);
        }

        Instant now = Instant.now();
        Instant from = request.effectiveFrom() == null ? now : request.effectiveFrom();
        if (from.isBefore(now.minus(BACKDATE_TOLERANCE)) || from.isAfter(now.plus(MAX_SCHEDULE_AHEAD))) {
            throw new AppException(ErrorCode.PRICING_INVALID);
        }
        if (from.isBefore(now)) {
            from = now;
        }

        // Lock the open version of this pair so two admins cannot fork the chain.
        List<CreditPricingConfig> open = repository.findOpenForUpdate(capability, scope);
        CreditPricingConfig previous = open.stream()
                .max(Comparator.comparing(CreditPricingConfig::getEffectiveFrom))
                .orElse(null);
        if (previous != null) {
            // A new version may only follow the latest one (incl. a scheduled one) — no rewriting history.
            if (!from.isAfter(previous.getEffectiveFrom())) {
                throw new AppException(ErrorCode.PRICING_INVALID);
            }
            boolean large = isLargeChange(previous.getInfraCoefficientX(), x)
                    || isLargeChange(nz(previous.getTokenCoefficientY()), y);
            if (large && !Boolean.TRUE.equals(request.confirmLargeChange())) {
                throw new AppException(ErrorCode.PRICING_LARGE_CHANGE_UNCONFIRMED);
            }
            for (CreditPricingConfig row : open) {
                row.setEffectiveTo(from);
            }
            repository.saveAll(open);
        }

        CreditPricingConfig version = new CreditPricingConfig();
        version.setCapability(capability);
        version.setProviderScope(scope);
        version.setInfraCoefficientX(x);
        version.setTokenCoefficientY(y);
        version.setEffectiveFrom(from);
        version.setCreatedByUserId(adminUserId);
        version.setChangeReason(reason);
        CreditPricingConfig saved;
        try {
            saved = repository.saveAndFlush(version);
        } catch (DataIntegrityViolationException e) {
            // ux_credit_pricing_open: a concurrent request opened a first version of the same pair.
            throw new AppException(ErrorCode.PRICING_INVALID);
        }

        log.info("Pricing version created by admin={} capability={} scope={} x={} y={} from={} reason='{}'",
                adminUserId, capability, scope, x, y, from, reason);

        return new CreatePricingVersionResponse(
                PricingVersionResponse.from(saved, now),
                previous == null ? null : PricingVersionResponse.from(previous, now),
                warnings(capability, scope, y, now));
    }

    @Override
    @Transactional(readOnly = true)
    public PricingPreviewResponse preview(PricingPreviewRequest request) {
        String capability = requireCapability(request.capability());
        String scope = normalizeScope(request.providerScope());
        BigDecimal x = coefficient(request.infraCoefficientX());
        BigDecimal y = coefficient(request.tokenCoefficientY());
        Instant now = Instant.now();

        Optional<CreditPricingConfig> exact = openRows(now).stream()
                .filter(c -> c.getCapability().equals(capability) && Objects.equals(c.getProviderScope(), scope))
                .findFirst();
        // Without a row for this exact pair, compare with what billing applies to it today.
        Optional<CreditPricingConfig> current = exact.isPresent() ? exact : repository.resolve(capability, scope, now);

        long unitsPerMinute = UNITS_PER_MINUTE.getOrDefault(capability, 1L);
        BigDecimal currentX = current.map(CreditPricingConfig::getInfraCoefficientX).orElse(FALLBACK_INFRA_X);
        BigDecimal currentY = current.map(c -> nz(c.getTokenCoefficientY())).orElse(FALLBACK_TOKEN_Y);

        boolean largeChange = exact.isPresent()
                && (isLargeChange(currentX, x) || isLargeChange(currentY, y));

        List<PricingPreviewResponse.JobEstimate> estimates = new ArrayList<>();
        for (Map.Entry<String, List<String>> job : JOB_TYPES.entrySet()) {
            BigDecimal currentTotal = BigDecimal.ZERO;
            BigDecimal proposedTotal = BigDecimal.ZERO;
            for (String cap : job.getValue()) {
                BigDecimal perUnit = defaultPlatformRate(cap, now);
                BigDecimal units = BigDecimal.valueOf(UNITS_PER_MINUTE.getOrDefault(cap, 1L));
                currentTotal = currentTotal.add(perUnit.multiply(units));
                proposedTotal = proposedTotal.add((cap.equals(capability) ? x.add(y) : perUnit).multiply(units));
            }
            estimates.add(new PricingPreviewResponse.JobEstimate(job.getKey(), job.getValue(),
                    money(currentTotal), money(proposedTotal)));
        }

        return new PricingPreviewResponse(
                capability,
                scope,
                current.map(c -> PricingVersionResponse.from(c, now)).orElse(null),
                unitsPerMinute,
                rate(currentX, currentY, unitsPerMinute),
                rate(x, y, unitsPerMinute),
                changePercent(current.isPresent() ? currentX : null, x),
                changePercent(current.isPresent() ? currentY : null, y),
                largeChange,
                estimates,
                warnings(capability, scope, y, now));
    }

    @Override
    @Transactional(readOnly = true)
    public List<PricingCoverageItem> coverage(List<PricingCoverageTarget> targets) {
        Instant now = Instant.now();
        List<PricingCoverageItem> items = new ArrayList<>();
        for (PricingCoverageTarget t : targets) {
            String protocol = t.protocol() == null ? "" : t.protocol().trim().toLowerCase(Locale.ROOT);
            String model = t.model() == null ? "" : t.model().trim().toLowerCase(Locale.ROOT);
            String scope = model.isEmpty() ? protocol : protocol + "/" + model;

            MatchedBy matchedBy = MatchedBy.MISSING;
            CreditPricingConfig match = null;
            List<CreditPricingConfig> exact = repository.findEffectiveScoped(t.capability(), scope, now);
            if (!exact.isEmpty()) {
                matchedBy = MatchedBy.EXACT;
                match = exact.get(0);
            } else {
                List<CreditPricingConfig> byProtocol = protocol.isEmpty() || protocol.equals(scope)
                        ? List.of() : repository.findEffectiveScoped(t.capability(), protocol, now);
                if (!byProtocol.isEmpty()) {
                    matchedBy = MatchedBy.PROTOCOL;
                    match = byProtocol.get(0);
                } else {
                    List<CreditPricingConfig> byDefault = repository.findEffectiveDefault(t.capability(), now);
                    if (!byDefault.isEmpty()) {
                        matchedBy = MatchedBy.DEFAULT;
                        match = byDefault.get(0);
                    }
                }
            }
            items.add(new PricingCoverageItem(t.providerId(), t.providerName(), t.capability(), scope, matchedBy,
                    match == null ? null : match.getId(),
                    match == null ? null : match.getProviderScope(),
                    match == null ? null : match.getInfraCoefficientX(),
                    match == null ? null : nz(match.getTokenCoefficientY())));
        }
        return items;
    }

    // --- helpers -----------------------------------------------------------------------------

    /**
     * Non-blocking checks (§10.3): the default row is used for unknown models, so it should
     * be at least as expensive as the priciest scoped row (P4), and it should exist at all.
     */
    private List<String> warnings(String capability, String scope, BigDecimal proposedY, Instant now) {
        List<CreditPricingConfig> open = openRows(now).stream()
                .filter(c -> c.getCapability().equals(capability))
                .toList();
        BigDecimal defaultY = scope == null ? proposedY : open.stream()
                .filter(c -> c.getProviderScope() == null)
                .map(c -> nz(c.getTokenCoefficientY()))
                .findFirst().orElse(null);
        BigDecimal maxScopedY = open.stream()
                .filter(c -> c.getProviderScope() != null && !c.getProviderScope().equals(scope))
                .map(c -> nz(c.getTokenCoefficientY()))
                .max(Comparator.naturalOrder())
                .orElse(null);
        if (scope != null && (maxScopedY == null || proposedY.compareTo(maxScopedY) > 0)) {
            maxScopedY = proposedY;
        }
        List<String> warnings = new ArrayList<>();
        if (defaultY == null) {
            warnings.add(WARN_NO_DEFAULT_ROW);
        } else if (maxScopedY != null && defaultY.compareTo(maxScopedY) < 0) {
            warnings.add(WARN_DEFAULT_BELOW_SCOPED);
        }
        return warnings;
    }

    /** Open (latest) version of every pair, including scheduled ones. */
    private List<CreditPricingConfig> openRows(Instant now) {
        return repository.findCurrentAndScheduled(now).stream()
                .filter(c -> c.getEffectiveTo() == null)
                .toList();
    }

    private BigDecimal defaultPlatformRate(String capability, Instant now) {
        return repository.findEffectiveDefault(capability, now).stream().findFirst()
                .map(c -> c.getInfraCoefficientX().add(nz(c.getTokenCoefficientY())))
                .orElse(FALLBACK_INFRA_X.add(FALLBACK_TOKEN_Y));
    }

    private static PricingPreviewResponse.Rate rate(BigDecimal x, BigDecimal y, long unitsPerMinute) {
        BigDecimal units = BigDecimal.valueOf(unitsPerMinute);
        return new PricingPreviewResponse.Rate(x, x.add(y), money(x.multiply(units)), money(x.add(y).multiply(units)));
    }

    static boolean isLargeChange(BigDecimal before, BigDecimal after) {
        BigDecimal old = nz(before);
        if (old.signum() == 0) {
            return after.signum() != 0;
        }
        BigDecimal ratio = after.subtract(old).abs().divide(old, 6, RoundingMode.HALF_UP);
        return ratio.compareTo(LARGE_CHANGE_RATIO) > 0;
    }

    private static BigDecimal changePercent(BigDecimal before, BigDecimal after) {
        if (before == null || before.signum() == 0) {
            return null;
        }
        return after.subtract(before).multiply(BigDecimal.valueOf(100))
                .divide(before, 1, RoundingMode.HALF_UP);
    }

    static String requireCapability(String capability) {
        String cap = capability == null ? "" : capability.trim().toUpperCase(Locale.ROOT);
        if (!CAPABILITIES.contains(cap)) {
            throw new AppException(ErrorCode.PRICING_INVALID);
        }
        return cap;
    }

    /** {@code protocol/model} in lower case, as recorded by the provider resolver; blank = default row. */
    static String normalizeScope(String providerScope) {
        if (providerScope == null || providerScope.isBlank()) {
            return null;
        }
        String scope = providerScope.trim().toLowerCase(Locale.ROOT);
        if (scope.length() > 100 || !SCOPE.matcher(scope).matches()) {
            throw new AppException(ErrorCode.PRICING_INVALID);
        }
        return scope;
    }

    private static BigDecimal coefficient(BigDecimal value) {
        if (value == null || value.signum() < 0 || value.compareTo(new BigDecimal("10000")) >= 0) {
            throw new AppException(ErrorCode.PRICING_INVALID);
        }
        try {
            return value.setScale(6, RoundingMode.UNNECESSARY);
        } catch (ArithmeticException e) {
            throw new AppException(ErrorCode.PRICING_INVALID);
        }
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(4, RoundingMode.HALF_UP);
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static Map<String, List<String>> jobTypes() {
        Map<String, List<String>> jobs = new LinkedHashMap<>();
        jobs.put("SUBTITLE", List.of("STT", "TRANSLATE"));
        jobs.put("DUB", List.of("STT", "TRANSLATE", "TTS"));
        jobs.put("SUMMARY_VLM", List.of("STT", "SUMMARIZE_SCRIPT", "VISION"));
        return jobs;
    }
}

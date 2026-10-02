package com.app.modules.platform.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.dto.AdminCreditAdjustResponse;
import com.app.modules.credit.dto.CreditAccountSnapshot;
import com.app.modules.credit.dto.CreditPurchaseResponse;
import com.app.modules.credit.entity.CreditPurchaseStatus;
import com.app.modules.credit.service.CreditService;
import com.app.modules.platform.dto.PlatformCreditAccountItem;
import com.app.modules.platform.dto.PlatformCreditMonitorResponse;
import com.app.modules.platform.dto.PlatformCreditPurchaseItem;
import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.PlatformUserCreditBalanceResponse;
import com.app.modules.platform.entity.PlatformUserView;
import com.app.modules.platform.repository.PlatformUserViewRepository;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformCreditService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class PlatformCreditServiceImpl implements PlatformCreditService {

    private final PlatformAdminAccessService accessService;
    private final UserRepository userRepository;
    private final CreditService creditService;
    private final PlatformUserViewRepository userViewRepository;

    private static final Duration MONITOR_WINDOW = Duration.ofDays(7);

    public PlatformCreditServiceImpl(PlatformAdminAccessService accessService,
                                     UserRepository userRepository,
                                     CreditService creditService,
                                     PlatformUserViewRepository userViewRepository) {
        this.accessService = accessService;
        this.userRepository = userRepository;
        this.creditService = creditService;
        this.userViewRepository = userViewRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformUserCreditBalanceResponse getUserBalance(UUID callerId, UUID targetUserId) {
        accessService.requirePlatformAdmin(callerId);
        requireUserExists(targetUserId);
        return new PlatformUserCreditBalanceResponse(targetUserId, creditService.getBalance(targetUserId));
    }

    @Override
    @Transactional
    public AdminCreditAdjustResponse adjustUserCredit(UUID callerId, UUID targetUserId,
                                                      BigDecimal amount, String reason) {
        accessService.requirePlatformAdmin(callerId);
        requireUserExists(targetUserId);
        String normalizedReason = reason == null || reason.isBlank() ? null : reason.trim();
        return creditService.adminAdjustCredit(callerId, targetUserId, amount, normalizedReason);
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformCreditMonitorResponse creditMonitor(UUID callerId, String q, boolean flaggedOnly,
                                                       MonitorSort sort, int page, int size) {
        accessService.requirePlatformAdmin(callerId);
        // In memory: one aggregated row per account is small at single-VPS scale (Deployment_Network.md).
        List<CreditAccountSnapshot> snapshots = creditService.snapshotAccounts(
                Instant.now().minus(MONITOR_WINDOW));
        Map<UUID, PlatformUserView> users = userViewRepository.findAllById(
                        snapshots.stream().map(CreditAccountSnapshot::userId).toList())
                .stream()
                .collect(Collectors.toMap(PlatformUserView::getId, Function.identity()));

        List<PlatformCreditAccountItem> all = snapshots.stream()
                .map(s -> toAccountItem(s, users.get(s.userId())))
                .toList();
        String needle = q == null || q.isBlank() ? null : q.trim().toLowerCase(Locale.ROOT);
        List<PlatformCreditAccountItem> matched = new ArrayList<>(all.stream()
                .filter(item -> !flaggedOnly || !item.flags().isEmpty())
                .filter(item -> needle == null || contains(item.email(), needle) || contains(item.fullName(), needle))
                .toList());
        matched.sort(monitorOrder(sort != null ? sort : MonitorSort.BALANCE));

        int pageSize = Math.max(1, Math.min(size, 100));
        int pageIndex = Math.max(0, page);
        int from = Math.min(pageIndex * pageSize, matched.size());
        int to = Math.min(from + pageSize, matched.size());
        Page<PlatformCreditAccountItem> pageResult = new PageImpl<>(
                matched.subList(from, to), PageRequest.of(pageIndex, pageSize), matched.size());

        return new PlatformCreditMonitorResponse(
                all.size(),
                all.stream().filter(item -> !item.flags().isEmpty()).count(),
                sum(all, PlatformCreditAccountItem::balance),
                sum(all, PlatformCreditAccountItem::credited7d),
                sum(all, PlatformCreditAccountItem::used7d),
                PlatformPageResponse.from(pageResult));
    }

    private static PlatformCreditAccountItem toAccountItem(CreditAccountSnapshot s, PlatformUserView user) {
        List<String> flags = new ArrayList<>();
        if (s.ledgerMismatch()) {
            flags.add(PlatformCreditAccountItem.FLAG_LEDGER_MISMATCH);
        }
        if (s.hasUnverifiedCredit()) {
            flags.add(PlatformCreditAccountItem.FLAG_UNVERIFIED_CREDIT);
        }
        return new PlatformCreditAccountItem(s.userId(),
                user != null ? user.getEmail() : null, user != null ? user.getFullName() : null,
                s.balance(), s.ledgerBalance(), s.creditedInWindow(), s.usedInWindow(), s.unverifiedCredit(),
                s.lastActivityAt(), List.copyOf(flags));
    }

    /** Flagged accounts first, then the chosen metric, highest first. */
    private static Comparator<PlatformCreditAccountItem> monitorOrder(MonitorSort sort) {
        Function<PlatformCreditAccountItem, BigDecimal> metric = switch (sort) {
            case BALANCE -> PlatformCreditAccountItem::balance;
            case CREDITED_7D -> PlatformCreditAccountItem::credited7d;
            case USED_7D -> PlatformCreditAccountItem::used7d;
        };
        return Comparator.<PlatformCreditAccountItem>comparingInt(item -> item.flags().isEmpty() ? 1 : 0)
                .thenComparing(metric, Comparator.reverseOrder());
    }

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(needle);
    }

    private static BigDecimal sum(List<PlatformCreditAccountItem> items,
                                  Function<PlatformCreditAccountItem, BigDecimal> field) {
        return items.stream().map(field).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    @Override
    @Transactional(readOnly = true)
    public PlatformPageResponse<PlatformCreditPurchaseItem> listPurchases(UUID callerId, CreditPurchaseStatus status,
                                                                          int page, int size) {
        accessService.requirePlatformAdmin(callerId);
        Page<CreditPurchaseResponse> purchases = creditService.listPurchases(status, page, size);
        Map<UUID, PlatformUserView> users = userViewRepository.findAllById(
                        purchases.getContent().stream().map(CreditPurchaseResponse::userId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(PlatformUserView::getId, Function.identity()));
        return PlatformPageResponse.from(purchases.map(p -> withUser(p, users.get(p.userId()))));
    }

    @Override
    @Transactional
    public PlatformCreditPurchaseItem approvePurchase(UUID callerId, UUID purchaseId, String note) {
        accessService.requirePlatformAdmin(callerId);
        return withUser(creditService.approvePurchase(callerId, purchaseId, note));
    }

    @Override
    @Transactional
    public PlatformCreditPurchaseItem rejectPurchase(UUID callerId, UUID purchaseId, String note) {
        accessService.requirePlatformAdmin(callerId);
        return withUser(creditService.rejectPurchase(callerId, purchaseId, note));
    }

    private PlatformCreditPurchaseItem withUser(CreditPurchaseResponse purchase) {
        return withUser(purchase, userViewRepository.findById(purchase.userId()).orElse(null));
    }

    private static PlatformCreditPurchaseItem withUser(CreditPurchaseResponse purchase, PlatformUserView user) {
        return PlatformCreditPurchaseItem.of(purchase,
                user != null ? user.getEmail() : null, user != null ? user.getFullName() : null);
    }

    private void requireUserExists(UUID userId) {
        if (!userRepository.existsById(userId)) {
            throw new AppException(ErrorCode.RESOURCE_NOT_FOUND);
        }
    }
}

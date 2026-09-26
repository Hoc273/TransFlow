package com.app.modules.platform.controller;

import com.app.common.security.AuthenticatedUser;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.entity.CreditPricingConfig;
import com.app.modules.credit.repository.CreditPricingConfigRepository;
import com.app.modules.platform.entity.PlatformAdminAuditAction;
import com.app.modules.platform.repository.PlatformAdminAuditLogRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PlatformPricingControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private CreditPricingConfigRepository pricingRepository;
    @Autowired
    private PlatformAdminAuditLogRepository auditLogRepository;

    private User adminUser;
    private User normalUser;

    @BeforeEach
    void setup() {
        pricingRepository.deleteAll();
        auditLogRepository.deleteAll();
        userRepository.findByEmailIgnoreCase("pricing-admin@transflow.com").ifPresent(userRepository::delete);
        userRepository.findByEmailIgnoreCase("pricing-user@transflow.com").ifPresent(userRepository::delete);
        adminUser = user("pricing-admin@transflow.com", true);
        normalUser = user("pricing-user@transflow.com", false);
    }

    private User user(String email, boolean admin) {
        User u = new User();
        u.setEmail(email);
        u.setFullName(email);
        u.setPasswordHash("hashed");
        u.setStatus(UserStatus.ACTIVE);
        u.setPlatformAdmin(admin);
        return userRepository.save(u);
    }

    private void authenticateAs(User user) {
        AuthenticatedUser authUser = new AuthenticatedUser(user.getId(), user.getEmail());
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(authUser, null, Collections.emptyList()));
    }

    private ResultActions create(String capability, String scope, String x, String y, Instant from,
                                 Boolean confirm) throws Exception {
        StringBuilder body = new StringBuilder("{\"capability\":\"").append(capability).append('"');
        if (scope != null) {
            body.append(",\"providerScope\":\"").append(scope).append('"');
        }
        body.append(",\"infraCoefficientX\":").append(x)
                .append(",\"tokenCoefficientY\":").append(y)
                .append(",\"changeReason\":\"test\"");
        if (from != null) {
            body.append(",\"effectiveFrom\":\"").append(from).append('"');
        }
        if (confirm != null) {
            body.append(",\"confirmLargeChange\":").append(confirm);
        }
        body.append('}');
        return mockMvc.perform(post("/api/platform/pricing")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.toString()));
    }

    private JsonNode data(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString()).path("data");
    }

    @Test
    void nonAdminCannotReadOrChangePrices() throws Exception {
        authenticateAs(normalUser);

        mockMvc.perform(get("/api/platform/pricing")).andExpect(status().isForbidden());
        create("TTS", null, "0.0001", "0.0005", null, null).andExpect(status().isForbidden());
        assertThat(pricingRepository.count()).isZero();
    }

    @Test
    void newVersionClosesThePreviousAndBillingKeepsTheOldPriceBeforeItStarts() throws Exception {
        authenticateAs(adminUser);

        JsonNode first = data(create("TTS", null, "0.000100", "0.000500", null, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version.status").value("ACTIVE"))
                .andExpect(jsonPath("$.data.version.createdByUserId").value(adminUser.getId().toString()))
                .andExpect(jsonPath("$.data.closedVersion").doesNotExist()));

        Instant start = Instant.now().plus(Duration.ofHours(1));
        create("TTS", null, "0.000110", "0.000520", start, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.data.closedVersion.id").value(first.path("version").path("id").asText()));

        CreditPricingConfig closed = pricingRepository.findById(UUID.fromString(first.path("version").path("id").asText()))
                .orElseThrow();
        assertThat(closed.getEffectiveTo()).isNotNull();
        assertThat(closed.getChangeReason()).isEqualTo("test");

        // A job created now keeps the old price; one created after the start gets the new one.
        assertThat(pricingRepository.resolve("TTS", null, Instant.now()).orElseThrow().getTokenCoefficientY())
                .isEqualByComparingTo("0.000500");
        assertThat(pricingRepository.resolve("TTS", null, start.plusSeconds(1)).orElseThrow().getTokenCoefficientY())
                .isEqualByComparingTo("0.000520");

        mockMvc.perform(get("/api/platform/pricing"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
        mockMvc.perform(get("/api/platform/pricing/history").param("capability", "TTS").param("providerScope", "default"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].status").value("SCHEDULED"));

        // Cannot slot a version before the scheduled one.
        create("TTS", null, "0.000110", "0.000520", start.minusSeconds(60), null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(2305));

        assertThat(auditLogRepository.findAll())
                .anyMatch(log -> log.getAction() == PlatformAdminAuditAction.CREATE_PRICING);
    }

    @Test
    void rejectsBackDatingNegativeValuesAndUnknownCapabilities() throws Exception {
        authenticateAs(adminUser);

        create("TTS", null, "0.0001", "0.0005", Instant.now().minus(Duration.ofDays(1)), null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(2305));
        create("TTS", null, "-0.0001", "0.0005", null, null)
                .andExpect(status().isBadRequest());
        create("DOCUMENT", null, "0.0001", "0.0005", null, null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(2305));
        create("TTS", "open ai/tts 1", "0.0001", "0.0005", null, null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(2305));
        assertThat(pricingRepository.count()).isZero();
    }

    @Test
    void largeChangeNeedsConfirmation() throws Exception {
        authenticateAs(adminUser);
        create("TRANSLATE", null, "0.000100", "0.000400", null, null).andExpect(status().isOk());

        Instant later = Instant.now().plus(Duration.ofMinutes(10));
        create("TRANSLATE", null, "0.000100", "0.000900", later, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(2306));
        create("TRANSLATE", null, "0.000100", "0.000900", later, true)
                .andExpect(status().isOk());
    }

    @Test
    void scopedRowsWinOverTheDefaultAndCheapDefaultIsFlagged() throws Exception {
        authenticateAs(adminUser);
        create("TTS", null, "0.000027", "0.005850", null, null).andExpect(status().isOk());
        create("TTS", "OpenAI_Compatible/TTS-1", "0.000027", "0.005850", null, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version.providerScope").value("openai_compatible/tts-1"))
                .andExpect(jsonPath("$.data.warnings.length()").value(0));
        create("TTS", "openai_compatible/tts-1-hd", "0.000027", "0.011700", null, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.warnings[0]").value("DEFAULT_Y_BELOW_SCOPED_MAX"));
        create("TTS", "elevenlabs", "0.000027", "0.020000", null, null).andExpect(status().isOk());

        Instant now = Instant.now().plusSeconds(1);
        assertThat(pricingRepository.resolve("TTS", "openai_compatible/tts-1-hd", now).orElseThrow()
                .getTokenCoefficientY()).isEqualByComparingTo("0.011700");
        assertThat(pricingRepository.resolve("TTS", "elevenlabs/eleven_multilingual_v2", now).orElseThrow()
                .getProviderScope()).isEqualTo("elevenlabs");
        assertThat(pricingRepository.resolve("TTS", "openai_compatible/unknown", now).orElseThrow()
                .getProviderScope()).isNull();
    }

    @Test
    void previewShowsRatesWithoutSaving() throws Exception {
        authenticateAs(adminUser);
        create("TTS", null, "0.000100", "0.000500", null, null).andExpect(status().isOk());
        long rows = pricingRepository.count();

        mockMvc.perform(post("/api/platform/pricing/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"capability\":\"TTS\",\"infraCoefficientX\":0.0001,\"tokenCoefficientY\":0.0010}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.unitsPerMinute").value(1000))
                .andExpect(jsonPath("$.data.currentRate.platformPerMinute").value(0.6))
                .andExpect(jsonPath("$.data.proposedRate.platformPerMinute").value(1.1))
                .andExpect(jsonPath("$.data.tokenChangePercent").value(100.0))
                .andExpect(jsonPath("$.data.largeChange").value(true))
                .andExpect(jsonPath("$.data.jobEstimates[1].jobType").value("DUB"));

        assertThat(pricingRepository.count()).isEqualTo(rows);
        assertThat(pricingRepository.findAll()).allMatch(c -> c.getTokenCoefficientY().compareTo(new BigDecimal("0.0005")) == 0);
    }
}

package com.app.modules.credit;

import com.app.testsupport.TestRegistration;

import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.credit.dto.PurchaseCreditPackageRequest;
import com.app.modules.credit.entity.CreditPackage;
import com.app.modules.credit.repository.CreditPackageRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CreditControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private CreditPackageRepository creditPackageRepository;

    private String registerAndGetToken(String email, String name) throws Exception {
        RegisterRequest reg = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", name));
        MvcResult res = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString()).path("data");
        return json.path("accessToken").asText();
    }

    @Test
    void testCreditEndpointsLifecycle() throws Exception {
        // 1. Register a user (auto-inits credit with 100.0000 initial grant)
        String email = "credit_user_" + System.currentTimeMillis() + "@test.com";
        String token = registerAndGetToken(email, "Credit User");

        // 2. GET /api/users/me/credit -> should have 100.0000 balance
        mockMvc.perform(get("/api/users/me/credit")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.balance").value(100.0000));

        // 3. GET /api/users/me/credit/transactions -> should have INITIAL_GRANT transaction
        mockMvc.perform(get("/api/users/me/credit/transactions")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.items").isArray())
                .andExpect(jsonPath("$.data.items[0].type").value("INITIAL_GRANT"))
                .andExpect(jsonPath("$.data.items[0].amount").value(100.0000));

        // 4. GET /api/credit/packages -> lists active packages (tests run without Flyway seed data)
        if (creditPackageRepository.findByIsActiveTrueOrderByCreditAmountAsc().isEmpty()) {
            CreditPackage pkg = new CreditPackage();
            pkg.setName("Test Pack");
            pkg.setCreditAmount(new BigDecimal("500.0000"));
            pkg.setPriceAmount(new BigDecimal("50000.00"));
            creditPackageRepository.save(pkg);
        }
        MvcResult pkgResult = mockMvc.perform(get("/api/credit/packages")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data").isArray())
                .andReturn();

        JsonNode packagesNode = objectMapper.readTree(pkgResult.getResponse().getContentAsString()).path("data");
        assertTrue(packagesNode.size() > 0);
        String packageId = packagesNode.get(0).path("id").asText();
        double pkgCreditAmount = packagesNode.get(0).path("creditAmount").asDouble();

        // 5. POST /api/credit/packages/{packageId}/purchase -> only a PENDING request,
        //    a made-up reference must never add credit by itself
        String reference = "SIMULATED-REF-" + System.nanoTime();
        mockMvc.perform(post("/api/credit/packages/" + packageId + "/purchase")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new PurchaseCreditPackageRequest(reference))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.paymentReference").value(reference))
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.creditAmount").value(pkgCreditAmount));

        mockMvc.perform(get("/api/users/me/credit")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.balance").value(100.0000));

        // 6. The same reference cannot be submitted again (any letter case)
        mockMvc.perform(post("/api/credit/packages/" + packageId + "/purchase")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                new PurchaseCreditPackageRequest(reference.toLowerCase()))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(2309));

        // 7. GET /api/users/me/credit/purchases -> the request with its status
        mockMvc.perform(get("/api/users/me/credit/purchases")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].paymentReference").value(reference))
                .andExpect(jsonPath("$.data.items[0].status").value("PENDING"));
    }
}

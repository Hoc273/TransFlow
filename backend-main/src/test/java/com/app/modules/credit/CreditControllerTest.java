package com.app.modules.credit;

import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.credit.dto.PurchaseCreditPackageRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

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
    private ObjectMapper objectMapper;

    private String registerAndGetToken(String email, String name) throws Exception {
        RegisterRequest reg = new RegisterRequest(email, "Password123!", name);
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

        // 4. GET /api/credit/packages -> lists active packages
        MvcResult pkgResult = mockMvc.perform(get("/api/credit/packages")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data").isArray())
                .andReturn();

        JsonNode packagesNode = objectMapper.readTree(pkgResult.getResponse().getContentAsString()).path("data");
        if (packagesNode.size() > 0) {
            String packageId = packagesNode.get(0).path("id").asText();
            double pkgCreditAmount = packagesNode.get(0).path("creditAmount").asDouble();

            // 5. POST /api/credit/packages/{packageId}/purchase -> purchases package
            PurchaseCreditPackageRequest purchaseReq = new PurchaseCreditPackageRequest("SIMULATED-REF-999");
            mockMvc.perform(post("/api/credit/packages/" + packageId + "/purchase")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(purchaseReq)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(1000))
                    .andExpect(jsonPath("$.data.paymentReference").value("SIMULATED-REF-999"))
                    .andExpect(jsonPath("$.data.newBalance").value(100.0000 + pkgCreditAmount));

            // Verify updated balance on /api/users/me/credit
            mockMvc.perform(get("/api/users/me/credit")
                            .header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(1000))
                    .andExpect(jsonPath("$.data.balance").value(100.0000 + pkgCreditAmount));
        }
    }
}

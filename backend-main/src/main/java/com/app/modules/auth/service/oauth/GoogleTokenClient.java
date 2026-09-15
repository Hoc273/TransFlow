package com.app.modules.auth.service.oauth;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Exchanges an authorization code with Google's token endpoint and reads OIDC profile
 * claims from {@code id_token}.
 */
@Component
public class GoogleTokenClient {

    private static final Logger log = LoggerFactory.getLogger(GoogleTokenClient.class);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final AppProperties.Oauth.Google google;

    public GoogleTokenClient(ObjectMapper objectMapper, AppProperties props) {
        this.objectMapper = objectMapper;
        this.google = props.oauth().google();
        this.restClient = RestClient.builder().build();
    }

    public GoogleProfile exchangeCode(String authorizationCode, String codeVerifier) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("code", authorizationCode);
        form.add("client_id", google.clientId());
        form.add("client_secret", google.clientSecret());
        form.add("redirect_uri", google.redirectUri());
        form.add("grant_type", "authorization_code");
        form.add("code_verifier", codeVerifier);

        String body;
        try {
            body = restClient.post()
                    .uri(google.tokenUri())
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
        } catch (RestClientException ex) {
            log.warn("Google token exchange failed: {}", ex.toString());
            throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
        }

        if (body == null || body.isBlank()) {
            throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
        }

        try {
            JsonNode root = objectMapper.readTree(body);
            if (root.hasNonNull("error")) {
                log.warn("Google token endpoint returned error={}", root.path("error").asText());
                throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
            }
            String idToken = root.path("id_token").asText(null);
            if (idToken == null || idToken.isBlank()) {
                throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
            }
            return parseIdToken(idToken);
        } catch (AppException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("Failed to parse Google token response: {}", ex.toString());
            throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
        }
    }

    GoogleProfile parseIdToken(String idToken) {
        String[] parts = idToken.split("\\.");
        if (parts.length < 2) {
            throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
        }
        try {
            byte[] payloadBytes = Base64.getUrlDecoder().decode(padBase64(parts[1]));
            JsonNode payload = objectMapper.readTree(new String(payloadBytes, StandardCharsets.UTF_8));

            String sub = text(payload, "sub");
            String email = text(payload, "email");
            if (sub == null || email == null) {
                throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
            }
            boolean emailVerified = payload.path("email_verified").asBoolean(false)
                    || "true".equalsIgnoreCase(payload.path("email_verified").asText(""));
            String name = text(payload, "name");
            if (name == null || name.isBlank()) {
                name = email.contains("@") ? email.substring(0, email.indexOf('@')) : email;
            }
            String picture = text(payload, "picture");
            return new GoogleProfile(sub, email.trim(), emailVerified, name.trim(), picture);
        } catch (AppException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("Failed to parse Google id_token payload: {}", ex.toString());
            throw new AppException(ErrorCode.GOOGLE_OAUTH_FAILED);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            return null;
        }
        String s = v.asText();
        return s == null || s.isBlank() ? null : s;
    }

    private static String padBase64(String s) {
        int mod = s.length() % 4;
        if (mod == 0) {
            return s;
        }
        return s + "====".substring(mod);
    }

    public record GoogleProfile(
            String sub,
            String email,
            boolean emailVerified,
            String fullName,
            String avatarUrl
    ) {
    }
}

package com.app.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.math.BigDecimal;

/**
 * Strongly typed binding for the {@code app.*} configuration namespace.
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        Cors cors,
        Jwt jwt,
        String feOrigin,
        Oauth oauth,
        Credit credit,
        Storage storage,
        MediaWorker mediaWorker
) {
    public AppProperties {
        if (cors == null) {
            cors = new Cors("http://localhost:5173");
        }
        if (jwt == null) {
            jwt = new Jwt(null, 30, 14, null);
        }
        if (feOrigin == null || feOrigin.isBlank()) {
            feOrigin = cors.allowedOrigin();
        }
        if (oauth == null) {
            oauth = new Oauth(new Oauth.Google(null, null, null, null, null, 10, 120));
        }
        if (credit == null) {
            credit = new Credit(new BigDecimal("100.0000"));
        }
        if (storage == null) {
            storage = new Storage("http://localhost:9000", "minioadmin", "minioadmin", "transflow-media");
        }
        if (mediaWorker == null) {
            mediaWorker = new MediaWorker(null);
        }
    }

    public record Cors(String allowedOrigin) {
        public Cors {
            if (allowedOrigin == null || allowedOrigin.isBlank()) {
                allowedOrigin = "http://localhost:5173";
            }
        }
    }

    public record Jwt(
            String secret,
            long accessTtlMinutes,
            long refreshTtlDays,
            String issuer
    ) {
        public Jwt {
            if (secret == null || secret.isBlank()) {
                secret = "ZGV2LW9ubHktc2VjcmV0LWNoYW5nZS1tZS0zMi1ieXRlcy1sb25nISE=";
            }
            if (accessTtlMinutes <= 0) {
                accessTtlMinutes = 30;
            }
            if (refreshTtlDays <= 0) {
                refreshTtlDays = 14;
            }
            if (issuer == null || issuer.isBlank()) {
                issuer = "transflow";
            }
        }
    }

    public record Credit(BigDecimal initialGrantAmount) {
        public Credit {
            if (initialGrantAmount == null) {
                initialGrantAmount = new BigDecimal("100.0000");
            }
        }
    }

    public record Storage(String endpoint, String accessKey, String secretKey, String mediaBucket) {
        public Storage {
            if (endpoint == null || endpoint.isBlank()) {
                endpoint = "http://localhost:9000";
            }
            if (mediaBucket == null || mediaBucket.isBlank()) {
                mediaBucket = "transflow-media";
            }
        }
    }

    /** Shared secret for HMAC-signed callbacks from backend-media-worker (API_Contract.md §14). */
    public record MediaWorker(String hmacSecret) {
        public MediaWorker {
            if (hmacSecret == null || hmacSecret.isBlank()) {
                hmacSecret = "dev-only-media-worker-hmac-secret-change-me";
            }
        }
    }

    public record Oauth(Google google) {
        public Oauth {
            if (google == null) {
                google = new Google(null, null, null, null, null, 10, 120);
            }
        }

        public record Google(
                String clientId,
                String clientSecret,
                String redirectUri,
                String authorizationUri,
                String tokenUri,
                long stateTtlMinutes,
                long exchangeTtlSeconds
        ) {
            public Google {
                if (authorizationUri == null || authorizationUri.isBlank()) {
                    authorizationUri = "https://accounts.google.com/o/oauth2/v2/auth";
                }
                if (tokenUri == null || tokenUri.isBlank()) {
                    tokenUri = "https://oauth2.googleapis.com/token";
                }
                if (stateTtlMinutes <= 0) {
                    stateTtlMinutes = 10;
                }
                if (exchangeTtlSeconds <= 0) {
                    exchangeTtlSeconds = 120;
                }
            }

            public boolean isConfigured() {
                return clientId != null && !clientId.isBlank()
                        && clientSecret != null && !clientSecret.isBlank();
            }
        }
    }
}

package com.app.modules.auth.service.oauth;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.AuthResponse;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.auth.service.AuthService;
import com.app.modules.auth.service.oauth.GoogleOAuthSessionStore.OAuthPendingSession;
import com.app.modules.auth.service.oauth.GoogleTokenClient.GoogleProfile;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Backend-mediated Google OAuth 2.0 / OIDC service.
 */
@Service
public class GoogleOAuthService {

    private static final Logger log = LoggerFactory.getLogger(GoogleOAuthService.class);
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    public static final String ERR_EMAIL_UNVERIFIED = "google_email_unverified";
    public static final String ERR_ACCOUNT_CONFLICT = "google_account_conflict";
    public static final String ERR_DENIED = "google_denied";
    public static final String ERR_STATE_INVALID = "google_state_invalid";
    public static final String ERR_FAILED = "google_failed";
    public static final String ERR_NOT_CONFIGURED = "google_not_configured";

    private final AppProperties props;
    private final GoogleOAuthSessionStore sessionStore;
    private final GoogleTokenClient tokenClient;
    private final UserRepository userRepository;
    private final AuthService authService;

    public GoogleOAuthService(AppProperties props,
                              GoogleOAuthSessionStore sessionStore,
                              GoogleTokenClient tokenClient,
                              UserRepository userRepository,
                              AuthService authService) {
        this.props = props;
        this.sessionStore = sessionStore;
        this.tokenClient = tokenClient;
        this.userRepository = userRepository;
        this.authService = authService;
    }

    public String buildAuthorizationUrl(String mode, String redirect) {
        AppProperties.Oauth.Google google = props.oauth().google();
        if (!google.isConfigured()) {
            throw new AppException(ErrorCode.GOOGLE_NOT_CONFIGURED);
        }

        String safeMode = normalizeMode(mode);
        String safeRedirect = sanitizeInternalRedirect(redirect);

        String state = randomUrlSafe(32);
        String codeVerifier = randomUrlSafe(64);
        String codeChallenge = pkceChallengeS256(codeVerifier);

        sessionStore.saveState(state, new OAuthPendingSession(codeVerifier, safeMode, safeRedirect));

        return UriComponentsBuilder
                .fromUriString(google.authorizationUri())
                .queryParam("client_id", google.clientId())
                .queryParam("redirect_uri", google.redirectUri())
                .queryParam("response_type", "code")
                .queryParam("scope", "openid email profile")
                .queryParam("state", state)
                .queryParam("code_challenge", codeChallenge)
                .queryParam("code_challenge_method", "S256")
                .queryParam("access_type", "online")
                .queryParam("prompt", "select_account")
                .encode()
                .build()
                .toUriString();
    }

    @Transactional
    public String handleCallback(String code, String state, String errorFromGoogle) {
        if (errorFromGoogle != null && !errorFromGoogle.isBlank()) {
            if ("access_denied".equalsIgnoreCase(errorFromGoogle)) {
                return feErrorRedirect(ERR_DENIED);
            }
            log.warn("Google authorize error={}", errorFromGoogle);
            return feErrorRedirect(ERR_FAILED);
        }

        if (!props.oauth().google().isConfigured()) {
            return feErrorRedirect(ERR_NOT_CONFIGURED);
        }

        Optional<OAuthPendingSession> pending = sessionStore.consumeState(state);
        if (pending.isEmpty()) {
            return feErrorRedirect(ERR_STATE_INVALID);
        }
        if (code == null || code.isBlank()) {
            return feErrorRedirect(ERR_FAILED);
        }

        try {
            GoogleProfile profile = tokenClient.exchangeCode(code, pending.get().codeVerifier());
            if (!profile.emailVerified()) {
                return feErrorRedirect(ERR_EMAIL_UNVERIFIED);
            }

            UserUpsertResult upsertResult = upsertGoogleUser(profile);
            User user = upsertResult.user();

            // First-time login: trigger auto-init (Arch §3)
            if (upsertResult.isNewUser()) {
                authService.initDefaultWorkspaceAndCredit(user);
            }

            String exchangeCode = sessionStore.createExchangeCode(user.getId());
            return UriComponentsBuilder
                    .fromUriString(feOrigin() + "/auth/google/done")
                    .queryParam("code", exchangeCode)
                    .build(true)
                    .toUriString();
        } catch (GoogleAccountConflictException ex) {
            return feErrorRedirect(ERR_ACCOUNT_CONFLICT);
        } catch (AppException ex) {
            return feErrorRedirect(ERR_FAILED);
        } catch (Exception ex) {
            log.warn("Google callback processing failed: {}", ex.toString());
            return feErrorRedirect(ERR_FAILED);
        }
    }

    @Transactional
    public AuthResponse exchange(String code) {
        UUID userId = sessionStore.consumeExchangeCode(code)
                .orElseThrow(() -> new AppException(ErrorCode.INVALID_REFRESH_TOKEN));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new AppException(ErrorCode.USER_NOT_FOUND));
        if (user.getStatus() != UserStatus.ACTIVE) {
            throw new AppException(ErrorCode.ACCOUNT_DISABLED);
        }

        AuthService.WorkspaceProjectInit init = authService.resolveOrCreateDefaultWorkspaceAndProject(user);
        return authService.issueAuthTokens(user, init.workspaceId(), init.projectId());
    }

    UserUpsertResult upsertGoogleUser(GoogleProfile profile) {
        Optional<User> bySub = userRepository.findByGoogleSub(profile.sub());
        if (bySub.isPresent()) {
            User existing = bySub.get();
            if (profile.fullName() != null && !profile.fullName().isBlank()) {
                existing.setFullName(profile.fullName().trim());
            }
            existing.setGoogleLinked(true);
            return new UserUpsertResult(userRepository.save(existing), false);
        }

        Optional<User> byEmail = userRepository.findByEmailIgnoreCase(profile.email());
        if (byEmail.isPresent()) {
            User existing = byEmail.get();
            if (existing.getGoogleSub() != null && !existing.getGoogleSub().equals(profile.sub())) {
                throw new GoogleAccountConflictException();
            }
            // Auto-link existing account with Google
            existing.setGoogleSub(profile.sub());
            existing.setGoogleLinked(true);
            if (profile.fullName() != null && !profile.fullName().isBlank()) {
                existing.setFullName(profile.fullName().trim());
            }
            return new UserUpsertResult(userRepository.save(existing), false);
        }

        // New user
        User created = new User();
        created.setEmail(profile.email().trim().toLowerCase(Locale.ROOT));
        created.setPasswordHash(null);
        created.setFullName(profile.fullName().trim());
        created.setStatus(UserStatus.ACTIVE);
        created.setGoogleSub(profile.sub());
        created.setGoogleLinked(true);
        User saved = userRepository.save(created);
        return new UserUpsertResult(saved, true);
    }

    private String feErrorRedirect(String errorCode) {
        return UriComponentsBuilder
                .fromUriString(feOrigin() + "/auth/google/done")
                .queryParam("error", errorCode)
                .build(true)
                .toUriString();
    }

    private String feOrigin() {
        String origin = props.feOrigin();
        if (origin == null || origin.isBlank()) {
            origin = props.cors().allowedOrigin();
        }
        if (origin.endsWith("/")) {
            return origin.substring(0, origin.length() - 1);
        }
        return origin;
    }

    static String normalizeMode(String mode) {
        if (mode == null || mode.isBlank()) {
            return "login";
        }
        String m = mode.trim().toLowerCase(Locale.ROOT);
        return "register".equals(m) ? "register" : "login";
    }

    static String sanitizeInternalRedirect(String redirect) {
        if (redirect == null || redirect.isBlank()) {
            return null;
        }
        String r = redirect.trim();
        if (!r.startsWith("/w/")) {
            return null;
        }
        if (r.contains("://") || r.contains("//") || r.contains("\\") || r.contains("@")) {
            return null;
        }
        if (r.length() > 512) {
            return null;
        }
        return r;
    }

    static String randomUrlSafe(int numBytes) {
        byte[] buf = new byte[numBytes];
        SECURE_RANDOM.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    static String pkceChallengeS256(String codeVerifier) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception ex) {
            throw new IllegalStateException("PKCE SHA-256 unavailable", ex);
        }
    }

    record UserUpsertResult(User user, boolean isNewUser) {}

    static final class GoogleAccountConflictException extends RuntimeException {
        GoogleAccountConflictException() {
            super("google_account_conflict");
        }
    }
}

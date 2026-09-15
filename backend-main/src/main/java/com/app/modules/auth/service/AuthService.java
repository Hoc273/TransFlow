package com.app.modules.auth.service;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.security.JwtService;
import com.app.modules.auth.dto.*;
import com.app.modules.auth.entity.User;
import com.app.modules.auth.entity.UserStatus;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.entity.CostMode;
import com.app.modules.credit.service.CreditService;
import com.app.modules.project.entity.Project;
import com.app.modules.project.service.ProjectService;
import com.app.modules.workspace.entity.Workspace;
import com.app.modules.workspace.service.WorkspaceService;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {

    public static final String OAUTH_ONLY_PASSWORD_MESSAGE =
            "This account signs in with Google. Use Continue with Google, or set a password in Settings.";

    private final UserRepository userRepository;
    private final WorkspaceService workspaceService;
    private final ProjectService projectService;
    private final CreditService creditService;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AppProperties appProperties;

    public AuthService(UserRepository userRepository,
                       WorkspaceService workspaceService,
                       ProjectService projectService,
                       CreditService creditService,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       AppProperties appProperties) {
        this.userRepository = userRepository;
        this.workspaceService = workspaceService;
        this.projectService = projectService;
        this.creditService = creditService;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.appProperties = appProperties;
    }

    @Transactional
    public AuthResponse register(RegisterRequest req) {
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new AppException(ErrorCode.EMAIL_ALREADY_EXISTS);
        }

        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        user.setFullName(req.fullName().trim());
        user.setStatus(UserStatus.ACTIVE);
        user.setGoogleLinked(false);
        userRepository.save(user);

        // Auto-init Workspace, Project, Credit & BillingConfig in same transaction (Arch §3)
        WorkspaceProjectInit init = initDefaultWorkspaceAndCredit(user);

        return issueAuthTokens(user, init.workspaceId(), init.projectId());
    }

    @Transactional
    public AuthResponse login(LoginRequest req) {
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        User user = userRepository.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new AppException(ErrorCode.INVALID_CREDENTIALS));

        if (user.getStatus() != UserStatus.ACTIVE) {
            throw new AppException(ErrorCode.ACCOUNT_DISABLED);
        }
        if (user.getPasswordHash() == null || user.getPasswordHash().isBlank()) {
            throw new AppException(ErrorCode.OAUTH_ONLY_ACCOUNT);
        }
        if (!passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw new AppException(ErrorCode.INVALID_CREDENTIALS);
        }

        WorkspaceProjectInit init = resolveOrCreateDefaultWorkspaceAndProject(user);
        return issueAuthTokens(user, init.workspaceId(), init.projectId());
    }

    @Transactional(readOnly = true)
    public TokenRefreshResponse refresh(RefreshRequest req) {
        Claims claims;
        try {
            claims = jwtService.parse(req.refreshToken());
        } catch (JwtException | IllegalArgumentException ex) {
            throw new AppException(ErrorCode.INVALID_REFRESH_TOKEN);
        }

        if (!jwtService.isRefreshToken(claims)) {
            throw new AppException(ErrorCode.INVALID_REFRESH_TOKEN);
        }

        UUID userId = UUID.fromString(claims.getSubject());
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new AppException(ErrorCode.USER_NOT_FOUND));

        if (user.getStatus() != UserStatus.ACTIVE) {
            throw new AppException(ErrorCode.ACCOUNT_DISABLED);
        }

        String access = jwtService.generateAccessToken(user.getId(), user.getEmail());
        String refresh = jwtService.generateRefreshToken(user.getId());
        return new TokenRefreshResponse(access, refresh);
    }

    @Transactional(readOnly = true)
    public UserResponse me(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new AppException(ErrorCode.USER_NOT_FOUND));
        return UserResponse.from(user);
    }

    /**
     * Auto-initialization sequence per System_Architecture.md §3:
     * 1. workspaces (owner = user) + workspace_members (role = LEAD) via WorkspaceService
     * 2. default project ("Default Project") via ProjectService
     * 3. credit_accounts (initial grant) + credit_transactions (type = INITIAL_GRANT) via CreditService
     * 4. workspace_billing_configs (cost_mode = PAY_PER_USER) via CreditService
     * All execute within the caller's transaction.
     */
    @Transactional
    public WorkspaceProjectInit initDefaultWorkspaceAndCredit(User user) {
        // 1 & 2. Workspace and LEAD member
        Workspace workspace = workspaceService.createDefaultWorkspace(user.getId(), user.getFullName());

        // 3. Default project
        Project project = projectService.createDefaultProject(workspace.getId());

        // 4. Initial Credit Grant (SRS §5.6, Arch §3)
        creditService.grantInitialCredit(user.getId(), appProperties.credit().initialGrantAmount());

        // 5. Workspace Billing Config (cost_mode defaults to PAY_PER_USER)
        creditService.initWorkspaceBillingConfig(workspace.getId(), user.getId(), CostMode.PAY_PER_USER);

        return new WorkspaceProjectInit(workspace.getId(), project.getId());
    }

    /**
     * Resolves default workspace and project for existing users;
     * fallback to auto-init if absent.
     */
    @Transactional
    public WorkspaceProjectInit resolveOrCreateDefaultWorkspaceAndProject(User user) {
        Optional<UUID> defaultWsId = workspaceService.findDefaultWorkspaceIdForUser(user.getId());
        if (defaultWsId.isEmpty()) {
            return initDefaultWorkspaceAndCredit(user);
        }

        UUID workspaceId = defaultWsId.get();
        Project project = projectService.resolveOrCreateDefaultProject(workspaceId);

        return new WorkspaceProjectInit(workspaceId, project.getId());
    }

    public AuthResponse issueAuthTokens(User user, UUID workspaceId, UUID projectId) {
        String access = jwtService.generateAccessToken(user.getId(), user.getEmail());
        String refresh = jwtService.generateRefreshToken(user.getId());
        return new AuthResponse(access, refresh, UserResponse.from(user), workspaceId, projectId);
    }

    public record WorkspaceProjectInit(UUID workspaceId, UUID projectId) {}
}

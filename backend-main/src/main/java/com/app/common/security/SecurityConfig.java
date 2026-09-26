package com.app.common.security;

import com.app.common.config.AppProperties;
import com.app.common.config.SecurityProperties;
import com.app.common.dto.ApiResponse;
import com.app.common.exception.ErrorCode;
import com.app.modules.platform.security.PlatformAdminAuditFilter;
import com.app.modules.platform.service.PlatformAdminAuditService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private static final String[] PUBLIC_PATHS = {
            "/api/auth/register/**",
            "/api/auth/login",
            "/api/auth/refresh",
            "/api/auth/forgot-password/**",
            "/api/auth/google/**",
            "/api/auth/logout",
            "/actuator/health",
            "/actuator/health/**",
            "/api/guides/**"
    };

    private static final String[] HMAC_AUTHENTICATED_PATHS = {
            "/internal/media/**"
    };

    /** JSON API only: nothing should ever render, frame, or load sub-resources from a response. */
    private static final String API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    private static final String PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

    private final JwtAuthFilter jwtAuthFilter;
    private final PlatformAdminAuditService platformAdminAuditService;
    private final SecurityProperties securityProperties;
    private final FixedWindowRateLimiter rateLimiter;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter,
                          PlatformAdminAuditService platformAdminAuditService,
                          SecurityProperties securityProperties,
                          FixedWindowRateLimiter rateLimiter) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.platformAdminAuditService = platformAdminAuditService;
        this.securityProperties = securityProperties;
        this.rateLimiter = rateLimiter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http,
                                           ObjectMapper objectMapper,
                                           CorsConfigurationSource corsConfigurationSource) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Defaults already add X-Content-Type-Options, X-Frame-Options: DENY, no-cache and
                // HSTS (HTTPS requests only); extend with CSP / Referrer / Permissions policies.
                .headers(h -> h
                        .contentSecurityPolicy(csp -> csp.policyDirectives(API_CSP))
                        .referrerPolicy(rp -> rp.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER))
                        .httpStrictTransportSecurity(hsts -> hsts
                                .includeSubDomains(true)
                                .maxAgeInSeconds(31_536_000))
                        .addHeaderWriter(new StaticHeadersWriter("Permissions-Policy", PERMISSIONS_POLICY)))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        .requestMatchers(HttpMethod.POST, HMAC_AUTHENTICATED_PATHS).permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(eh -> eh
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setStatus(ErrorCode.UNAUTHENTICATED.getHttpStatusCode().value());
                            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            objectMapper.writeValue(response.getWriter(), ApiResponse.builder()
                                    .code(ErrorCode.UNAUTHENTICATED.getCode())
                                    .message(ErrorCode.UNAUTHENTICATED.getMessage())
                                    .build());
                        })
                        .accessDeniedHandler((request, response, ex) -> {
                            response.setStatus(ErrorCode.UNAUTHORIZED.getHttpStatusCode().value());
                            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                            objectMapper.writeValue(response.getWriter(), ApiResponse.builder()
                                    .code(ErrorCode.UNAUTHORIZED.getCode())
                                    .message(ErrorCode.UNAUTHORIZED.getMessage())
                                    .build());
                        }))
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new AuthThrottleFilter(rateLimiter, securityProperties, objectMapper),
                        JwtAuthFilter.class)
                // Audit-only: logs every /api/platform/** request incl. denied ones;
                // runs after JWT auth so the principal is populated when present.
                .addFilterAfter(new PlatformAdminAuditFilter(platformAdminAuditService),
                        JwtAuthFilter.class);

        if (securityProperties.requireHttps()) {
            // TLS terminates at the reverse proxy; isSecure() comes from its X-Forwarded-Proto
            // (server.forward-headers-strategy=native). In-network calls (worker callbacks,
            // health probes) stay on plain HTTP inside the private network.
            http.requiresChannel(ch -> ch
                    .requestMatchers("/internal/**", "/actuator/health", "/actuator/health/**").requiresInsecure()
                    .anyRequest().requiresSecure());
        }

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(AppProperties props) {
        CorsConfiguration cfg = new CorsConfiguration();
        String origin = (props != null && props.cors() != null && props.cors().allowedOrigin() != null)
                ? props.cors().allowedOrigin()
                : "http://localhost:5173";
        cfg.setAllowedOrigins(List.of(origin, "http://localhost:5173", "http://127.0.0.1:5173"));
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "Accept-Language", "X-Requested-With"));
        cfg.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);
        return source;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration cfg) throws Exception {
        return cfg.getAuthenticationManager();
    }
}

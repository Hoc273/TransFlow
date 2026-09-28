package com.app.modules.auth.entity;

public enum AuthSessionRevokeReason {
    LOGOUT,
    PASSWORD_CHANGED,
    PASSWORD_RESET,
    /** A superseded refresh token was replayed after the grace window — treated as theft. */
    TOKEN_REUSE,
    ACCOUNT_DISABLED
}

package com.app.modules.auth.service;

import java.util.Locale;
import java.util.Set;

/**
 * Canonical mailbox form used to stop one inbox from registering many accounts
 * (initial-credit farming) through provider aliases:
 * <ul>
 *   <li>any domain: {@code user+tag@x.com} → {@code user@x.com} (sub-addressing)</li>
 *   <li>Gmail: dots are ignored and {@code googlemail.com} = {@code gmail.com},
 *       so {@code U.S.E.R+1@googlemail.com} → {@code user@gmail.com}</li>
 * </ul>
 * The stored {@code users.email} keeps what the user typed (mail is delivered there);
 * only uniqueness is checked on this canonical form. Keep in sync with the backfill in
 * {@code V17__users_email_canonical.sql}.
 */
public final class EmailNormalizer {

    private static final Set<String> GMAIL_DOMAINS = Set.of("gmail.com", "googlemail.com");

    private EmailNormalizer() {
    }

    /** Lower-cased, trimmed address — the form stored in {@code users.email}. */
    public static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    public static String canonicalize(String email) {
        String e = normalize(email);
        int at = e.lastIndexOf('@');
        if (at <= 0 || at == e.length() - 1) {
            return e;
        }
        String local = e.substring(0, at);
        String domain = e.substring(at + 1);

        int plus = local.indexOf('+');
        if (plus > 0) {
            local = local.substring(0, plus);
        }
        if (GMAIL_DOMAINS.contains(domain)) {
            local = local.replace(".", "");
            domain = "gmail.com";
        }
        return local + "@" + domain;
    }
}

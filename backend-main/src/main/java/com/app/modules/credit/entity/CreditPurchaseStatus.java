package com.app.modules.credit.entity;

/**
 * Lifecycle of a credit package purchase. No payment gateway yet (Arch §14 item 3), so credit is
 * only granted once a Super Admin has matched the payment reference against the received transfer.
 */
public enum CreditPurchaseStatus {
    PENDING,
    APPROVED,
    REJECTED,
    /** Created before review existed: credited without any verification (migration V8). */
    LEGACY_UNVERIFIED
}

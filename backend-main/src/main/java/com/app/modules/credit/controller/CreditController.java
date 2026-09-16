package com.app.modules.credit.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.dto.PageResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.credit.dto.*;
import com.app.modules.credit.entity.CreditTransactionType;
import com.app.modules.credit.service.CreditService;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Controller for Credit & Payment APIs (API_Contract.md §10).
 */
@RestController
public class CreditController {

    private final CreditService creditService;

    public CreditController(CreditService creditService) {
        this.creditService = creditService;
    }

    /**
     * GET /api/users/me/credit
     * Lấy số dư credit của user hiện tại.
     */
    @GetMapping("/api/users/me/credit")
    public ApiResponse<CreditBalanceResponse> getMyCredit(@AuthenticationPrincipal AuthenticatedUser user) {
        BigDecimal balance = creditService.getBalance(user.id());
        return ApiResponse.<CreditBalanceResponse>builder()
                .data(new CreditBalanceResponse(balance))
                .build();
    }

    /**
     * GET /api/users/me/credit/transactions?type=&from=&to=&page=&size=
     * Danh sách giao dịch credit của user (charged_user hoặc performed_by_user).
     */
    @GetMapping("/api/users/me/credit/transactions")
    public ApiResponse<PageResponse<CreditTransactionResponse>> getMyTransactions(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) CreditTransactionType type,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageResponse<CreditTransactionResponse> response = creditService.getTransactions(user.id(), type, from, to, page, size);
        return ApiResponse.<PageResponse<CreditTransactionResponse>>builder()
                .data(response)
                .build();
    }

    /**
     * GET /api/credit/packages
     * Danh sách gói credit đang active.
     */
    @GetMapping("/api/credit/packages")
    public ApiResponse<List<CreditPackageResponse>> listPackages() {
        List<CreditPackageResponse> packages = creditService.listActivePackages();
        return ApiResponse.<List<CreditPackageResponse>>builder()
                .data(packages)
                .build();
    }

    /**
     * POST /api/credit/packages/{packageId}/purchase
     * Mua gói credit (chưa tích hợp cổng thanh toán thật, ghi nhận paymentReference).
     */
    @PostMapping("/api/credit/packages/{packageId}/purchase")
    public ApiResponse<PurchaseCreditPackageResponse> purchasePackage(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable UUID packageId,
            @Valid @RequestBody PurchaseCreditPackageRequest req) {
        PurchaseCreditPackageResponse response = creditService.purchasePackage(user.id(), packageId, req);
        return ApiResponse.<PurchaseCreditPackageResponse>builder()
                .data(response)
                .build();
    }
}

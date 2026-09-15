package com.app.modules.media_asset.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.media_asset.dto.ConsentRequest;
import com.app.modules.media_asset.dto.ConsentResponse;
import com.app.modules.media_asset.dto.MediaAssetResponse;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Media Asset & Consent (API_Contract.md §4, SRS §5.2). Upload creates the root
 * {@code SOURCE_VIDEO} asset directly — no {@code documents} table in transflow_mini.
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}")
public class MediaAssetController {

    private final MediaAssetService mediaAssetService;
    private final WorkspaceAccessService access;

    public MediaAssetController(MediaAssetService mediaAssetService, WorkspaceAccessService access) {
        this.mediaAssetService = mediaAssetService;
        this.access = access;
    }

    @GetMapping("/media/terms-version")
    public ApiResponse<Map<String, String>> currentTermsVersion(@AuthenticationPrincipal AuthenticatedUser user,
                                                                  @PathVariable UUID workspaceId) {
        if (access.getRole(workspaceId, user.id()) == Role.CLIENT) {
            throw new AppException(ErrorCode.UNAUTHORIZED);
        }
        return ApiResponse.<Map<String, String>>builder()
                .data(Map.of("termsVersion", mediaAssetService.currentTermsVersion()))
                .build();
    }

    @PostMapping(value = "/projects/{projectId}/media/assets", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<MediaAssetResponse> upload(@AuthenticationPrincipal AuthenticatedUser user,
                                                   @PathVariable UUID workspaceId,
                                                   @PathVariable UUID projectId,
                                                   @RequestParam("file") MultipartFile file,
                                                   @RequestParam(value = "name", required = false) String name) {
        var asset = mediaAssetService.upload(workspaceId, user.id(), projectId, file, name);
        return ApiResponse.<MediaAssetResponse>builder()
                .data(MediaAssetResponse.from(asset))
                .build();
    }

    @GetMapping("/projects/{projectId}/media/assets")
    public ApiResponse<List<MediaAssetResponse>> listAssets(@AuthenticationPrincipal AuthenticatedUser user,
                                                              @PathVariable UUID workspaceId,
                                                              @PathVariable UUID projectId) {
        var assets = mediaAssetService.listRootAssets(workspaceId, user.id(), projectId).stream()
                .map(MediaAssetResponse::from)
                .toList();
        return ApiResponse.<List<MediaAssetResponse>>builder().data(assets).build();
    }

    @GetMapping("/media/assets/{assetId}")
    public ApiResponse<MediaAssetResponse> getAsset(@AuthenticationPrincipal AuthenticatedUser user,
                                                     @PathVariable UUID workspaceId,
                                                     @PathVariable UUID assetId) {
        var asset = mediaAssetService.getAsset(workspaceId, user.id(), assetId);
        return ApiResponse.<MediaAssetResponse>builder().data(MediaAssetResponse.from(asset)).build();
    }

    @PostMapping("/media/assets/{assetId}/consent")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<ConsentResponse> consent(@AuthenticationPrincipal AuthenticatedUser user,
                                                 @PathVariable UUID workspaceId,
                                                 @PathVariable UUID assetId,
                                                 @Valid @RequestBody ConsentRequest req) {
        var consent = mediaAssetService.consent(workspaceId, user.id(), assetId, req.termsVersion());
        return ApiResponse.<ConsentResponse>builder().data(ConsentResponse.from(consent)).build();
    }
}

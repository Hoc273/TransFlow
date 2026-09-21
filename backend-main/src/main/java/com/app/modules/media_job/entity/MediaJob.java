package com.app.modules.media_job.entity;

import com.app.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.UUID;

/**
 * Localization + Summarization orchestrator (Database_Design.md §6.2). Written fresh for
 * transflow_mini — does NOT carry over CT0-CT5/W0-W1/documentId/ADR-CEP fields from the
 * legacy {@code transflow} MediaJob (see Backend_Java_TaskSplit_MemberB.md §2.2 warning).
 */
@Entity
@Table(name = "media_jobs")
@Getter
@Setter
public class MediaJob extends BaseEntity {

    /** {@code recipe_id IN ('localization.full','summary.script_match')} — not a Java enum, values contain dots. */
    public static final String RECIPE_LOCALIZATION_FULL = "localization.full";
    public static final String RECIPE_SUMMARY_SCRIPT_MATCH = "summary.script_match";

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "root_asset_id", nullable = false)
    private UUID rootAssetId;

    @Column(name = "batch_id")
    private UUID batchId;

    @Column(name = "recipe_id", nullable = false, length = 40)
    private String recipeId;

    @Enumerated(EnumType.STRING)
    @Column(name = "processing_mode", length = 20)
    private ProcessingMode processingMode;

    @Column(name = "source_language")
    private String sourceLanguage;

    @Column(name = "target_lang", nullable = false)
    private String targetLang;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private JobStatus status = JobStatus.PENDING;

    @Column(name = "requested_duration_seconds")
    private Integer requestedDurationSeconds;

    @Column(name = "selected_proposal_id")
    private UUID selectedProposalId;

    @Column(name = "source_summary_job_id")
    private UUID sourceSummaryJobId;

    @Enumerated(EnumType.STRING)
    @Column(name = "subtitle_mode", nullable = false, length = 20)
    private SubtitleMode subtitleMode = SubtitleMode.SOFT_SUB;

    @Enumerated(EnumType.STRING)
    @Column(name = "output_audio_mode", nullable = false, length = 20)
    private OutputAudioMode outputAudioMode = OutputAudioMode.ORIGINAL_ONLY;

    @Column(name = "source_separation_enabled", nullable = false)
    private boolean sourceSeparationEnabled = false;

    @Column(name = "tts_voice_id")
    private UUID ttsVoiceId;

    @Column(name = "visual_context_enabled", nullable = false)
    private boolean visualContextEnabled = false;

    @Column(name = "preset_id")
    private UUID presetId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "preset_snapshot", nullable = false)
    private String presetSnapshot = "{}";

    /** Render Studio config (merged {@code UpdateRenderConfigRequest} JSON); {@code {}} = nothing configured yet. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "render_config", nullable = false)
    private String renderConfig = "{}";

    @Enumerated(EnumType.STRING)
    @Column(name = "workflow_mode", nullable = false, length = 20)
    private WorkflowMode workflowMode = WorkflowMode.MANUAL;

    @Column(name = "performed_by_user_id", nullable = false)
    private UUID performedByUserId;

    /** Immutable after creation — sole authorization source for QA/checkpoint (SRS §3.3). Never update post-create. */
    @Column(name = "created_by_user_id", nullable = false, updatable = false)
    private UUID createdByUserId;

    public enum ProcessingMode { TRANSLATE_ONLY, HYBRID }

    public enum JobStatus { PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED }

    public enum SubtitleMode { HARD_SUB, SOFT_SUB }

    public enum OutputAudioMode { ORIGINAL_ONLY, DUB_REPLACE, DUB_MIX }

    public enum WorkflowMode { MANUAL, AUTO }
}

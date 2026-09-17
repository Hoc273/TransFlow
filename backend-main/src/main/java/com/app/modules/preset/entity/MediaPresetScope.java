package com.app.modules.preset.entity;

/**
 * Scope hierarchy for media presets (SRS §5.7, Database_Design.md §9).
 * - SYSTEM: Global preset/template available platform-wide (read-only for tenants).
 * - WORKSPACE: Scoped to a specific workspace and shared across all its projects.
 * - PROJECT: Scoped to a specific project within a workspace.
 */
public enum MediaPresetScope {
    SYSTEM,
    WORKSPACE,
    PROJECT
}

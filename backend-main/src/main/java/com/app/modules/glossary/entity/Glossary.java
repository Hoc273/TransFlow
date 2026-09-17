package com.app.modules.glossary.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * One terminology dictionary per Project (Database_Design.md §8.2 — {@code UNIQUE(project_id)}).
 * No Translation Memory here or anywhere in transflow_mini (SRS §4.3) — glossary terms are the only
 * reusable translation context.
 */
@Entity
@Table(name = "glossaries")
@Getter
@Setter
public class Glossary {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false, unique = true)
    private UUID projectId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}

package com.app.modules.glossary.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.util.UUID;

/** One source->target mapping in a {@link Glossary} (Database_Design.md §8.2). */
@Entity
@Table(name = "glossary_terms")
@Getter
@Setter
public class GlossaryTerm {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "glossary_id", nullable = false)
    private UUID glossaryId;

    @Column(name = "source_term", nullable = false)
    private String sourceTerm;

    @Column(name = "target_term", nullable = false)
    private String targetTerm;

    @Column(name = "target_lang", nullable = false)
    private String targetLang;
}

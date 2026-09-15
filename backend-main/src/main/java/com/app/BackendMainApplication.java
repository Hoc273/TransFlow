package com.app;

import com.app.common.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * Root package is {@code com.app} on purpose: component/entity scan covers every
 * {@code com.app.common.*} and {@code com.app.modules.*} package (CLAUDE.md §4.8).
 */
@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
@EnableJpaAuditing
public class BackendMainApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendMainApplication.class, args);
    }

}

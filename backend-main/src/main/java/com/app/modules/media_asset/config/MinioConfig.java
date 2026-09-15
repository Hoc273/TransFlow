package com.app.modules.media_asset.config;

import com.app.common.config.AppProperties;
import io.minio.MinioClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MinioConfig {

    @Bean
    public MinioClient minioClient(AppProperties props) {
        return MinioClient.builder()
                .endpoint(props.storage().endpoint())
                .credentials(props.storage().accessKey(), props.storage().secretKey())
                .build();
    }
}

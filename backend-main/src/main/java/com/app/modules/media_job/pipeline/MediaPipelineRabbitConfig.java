package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.entity.MediaJobStage;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Declarable;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.annotation.EnableRabbit;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.boot.autoconfigure.amqp.SimpleRabbitListenerContainerFactoryConfigurer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Rabbit topology for the eight media stages. Spring is the sole consumer. */
@Configuration
@EnableRabbit
@ConditionalOnProperty(name = "app.pipeline.enabled", havingValue = "true", matchIfMissing = true)
public class MediaPipelineRabbitConfig {

    public static final String EXCHANGE = "media.exchange";

    public static String queueName(MediaJobStage.StageName stage) {
        return "media.stage." + stage.name();
    }

    @Bean
    Declarables mediaStageDeclarables() {
        DirectExchange exchange = new DirectExchange(EXCHANGE, true, false);
        java.util.List<Declarable> declarations = new java.util.ArrayList<>();
        declarations.add(exchange);
        for (MediaJobStage.StageName stage : MediaJobStage.StageName.values()) {
            Queue queue = QueueBuilder.durable(queueName(stage)).build();
            declarations.add(queue);
            declarations.add(BindingBuilder.bind(queue).to(exchange).with(queueName(stage)));
        }
        return new Declarables(declarations);
    }

    @Bean
    MessageConverter mediaStageMessageConverter() {
        return new Jackson2JsonMessageConverter();
    }

    @Bean
    RabbitTemplate mediaStageRabbitTemplate(ConnectionFactory connectionFactory,
                                             MessageConverter mediaStageMessageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(mediaStageMessageConverter);
        return template;
    }

    @Bean(name = "mediaStageListenerContainerFactory")
    SimpleRabbitListenerContainerFactory mediaStageListenerContainerFactory(
            ConnectionFactory connectionFactory, MessageConverter mediaStageMessageConverter,
            SimpleRabbitListenerContainerFactoryConfigurer configurer) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        // Inherit the application-level acknowledge/retry/concurrency policy;
        // only the media-specific converter and poison-message behavior differ.
        configurer.configure(factory, connectionFactory);
        factory.setMessageConverter(mediaStageMessageConverter);
        factory.setDefaultRequeueRejected(false);
        return factory;
    }
}

# TransFlow backend-main (Spring Boot 3.3 / Java 21) — multi-stage build.
# Stage 1: build jar bằng Maven (cache dependency trước để rebuild nhanh).
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -DskipTests package

# Stage 2: runtime JRE gọn nhẹ.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]

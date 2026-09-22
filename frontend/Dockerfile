# TransFlow frontend (React 19 + Vite) — multi-stage build.
# Stage 1: build static dist. Mọi VITE_* đều bake vào bundle lúc build
# (Vite thay import.meta.env bằng giá trị tĩnh), nên muốn đổi API URL
# phải build lại image với --build-arg khác.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ARG VITE_DEFAULT_LANGUAGE=en
ARG VITE_ENABLE_GLOBAL_SEARCH=false
ARG VITE_ENABLE_GOOGLE_AUTH=true
ARG VITE_ENABLE_QA_OVERRIDE=true
ARG VITE_ENABLE_NARRATIVE_REVIEW_AI=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_DEFAULT_LANGUAGE=$VITE_DEFAULT_LANGUAGE \
    VITE_ENABLE_GLOBAL_SEARCH=$VITE_ENABLE_GLOBAL_SEARCH \
    VITE_ENABLE_GOOGLE_AUTH=$VITE_ENABLE_GOOGLE_AUTH \
    VITE_ENABLE_QA_OVERRIDE=$VITE_ENABLE_QA_OVERRIDE \
    VITE_ENABLE_NARRATIVE_REVIEW_AI=$VITE_ENABLE_NARRATIVE_REVIEW_AI
RUN npm run build

# Stage 2: serve dist bằng nginx, proxy /api/* sang backend-main.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

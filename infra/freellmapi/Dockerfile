# FreeLLMAPI + TransFlow speech patch (published as duckziec/freellmapi).
# Base is pinned by digest: patch-speech.mjs edits the upstream compiled JS and fails the
# build when an anchor no longer matches, so bump BASE_IMAGE deliberately and rebuild.
ARG BASE_IMAGE=ghcr.io/tashfeenahmed/freellmapi@sha256:cdf96061fa0d4fb719bf5d0e1b66a772b598bb5ef5f25ac356e4c342de616acf
FROM ${BASE_IMAGE}

COPY patch-speech.mjs /tmp/patch-speech.mjs
RUN node /tmp/patch-speech.mjs /app/server/dist \
    && node --check /app/server/dist/services/media.js \
    && node --check /app/server/dist/routes/proxy.js \
    && rm /tmp/patch-speech.mjs

LABEL org.opencontainers.image.title="freellmapi (TransFlow speech patch)" \
      org.opencontainers.image.base.name="ghcr.io/tashfeenahmed/freellmapi" \
      org.opencontainers.image.description="Cloudflare Deepgram Aura TTS body, speech language routing, TTS key rotation"

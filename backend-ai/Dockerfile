FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# No torch/demucs — CPU-only deployment has no GPU for Demucs separation
# (DemucsAdapter uses the deterministic CPU fallback when CUDA is absent).
RUN python -m pip install --no-cache-dir -r requirements.txt
# The default image is CPU/lightweight. DemucsAdapter uses the deterministic
# CPU fallback when CUDA is absent; GPU deployments should use Dockerfile.gpu
# for the real Demucs model.

# Bundle the MIT rhasspy/piper-voices models (V32 seed: 6 verified voices)
# from the repo checkout — matches the default `piper_voices_dir="piper/voices"`
# (relative to WORKDIR /app), so no PIPER_VOICES_DIR override is needed.
COPY piper/voices /app/piper/voices

COPY app ./app

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.12-slim

# Install ffmpeg and basic utilities required for media processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \n    && useradd --create-home --uid 10001 --user-group app

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Non-root: ffmpeg làm việc trong tempfile (/tmp); HOME cho fontconfig cache.
USER app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

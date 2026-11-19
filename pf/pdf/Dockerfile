# EnvironmSafe PDF service (deploy to Cloud Run, Render or Fly; set PDF_SERVICE_KEY).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY es_pdf ./es_pdf
COPY server.py .
ENV PORT=8080 ESPDF_FONT_DIR=/usr/share/fonts/truetype/noto
USER nobody
EXPOSE 8080
CMD ["python", "server.py"]

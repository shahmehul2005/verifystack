# Extractor service image. Build from the repo root:
#   docker build -t verifystack-extractor .
# The web app (Next.js, deployed on Vercel) is not part of this image.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYDANTIC_AI_NO_BANNER=1

WORKDIR /app

COPY services/requirements.txt services/requirements.txt
RUN pip install -r services/requirements.txt

COPY services services

RUN useradd --create-home appuser
USER appuser

# Hosts that set PORT (Render, Railway, Cloud Run) are honoured; default is 8000.
EXPOSE 8000
CMD ["sh", "-c", "python -m uvicorn services.extractor.api:app --host 0.0.0.0 --port ${PORT:-8000}"]

# syntax=docker/dockerfile:1
#
# Self-built mem0 API server image (#212 D8).
#
# Why self-built: the official `mem0/mem0-api-server` image has NO
# linux/amd64 manifest, and `pip install mem0ai[server]` does not exist
# (the server code lives in the mem0 repo's server/ directory, not in the
# PyPI package). We clone the mem0 repo at a pinned commit and run its
# server/ with uvicorn — deterministic and amd64-safe.
#
# The commit below is the pinned upstream main snapshot (server API v2:
# POST /memories, POST /search, GET /memories?agent_id=…, X-API-Key auth).
# Bump deliberately after verifying the new snapshot against the fork's
# SelfHostedMemoryClient (packages/pi-extension-mem0/test/).

FROM python:3.11-slim

WORKDIR /app

# git is needed to clone the pinned mem0 snapshot; removed after install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Pin to the exact upstream commit this stack was verified against.
ARG MEM0_SERVER_COMMIT=760dca6f391277d79c3c7d2096c1bf1d037526c3

RUN git clone --depth 1 https://github.com/mem0ai/mem0.git /tmp/mem0 \
    && cd /tmp/mem0 \
    && git fetch --depth 1 origin ${MEM0_SERVER_COMMIT} \
    && git checkout ${MEM0_SERVER_COMMIT} \
    && pip install --no-cache-dir -r server/requirements.txt \
    && cp -r server/. /app/ \
    && rm -rf /tmp/mem0 \
    && apt-get purge -y git \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1
ENV MEM0_TELEMETRY=false

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

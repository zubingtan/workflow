# T5 (#216): Self-built mem0 API server image.
#
# The official mem0/mem0-api-server:latest has NO linux/amd64 manifest,
# so we build from python:3.12-slim + the mem0 repo's server/ directory
# (vendored into docker/mem0/server/). Mirrors the official server/Dockerfile
# with two additions: psycopg-binary (slim has no libpq) and alembic in CMD.
#
# The server listens on port 8000 internally. docker-compose maps 8890:8000
# to avoid conflicts with local mem0 instances.
#
# Environment variables (set in docker-compose.yml):
#   MEM0_LLM_API_KEY      — API key for the LLM/embedding provider
#   MEM0_LLM_BASE_URL     — custom OpenAI-compatible endpoint (optional)
#   MEM0_LLM_MODEL        — LLM model name (default: gpt-5-mini)
#   MEM0_EMBEDDER_MODEL   — embedding model name (default: text-embedding-3-small)
#   MEM0_EMBEDDING_DIMS   — embedding vector dimensions (e.g. 1024)
#   MEM0_TELEMETRY        — set to "false" to disable telemetry
#   AUTH_DISABLED          — "true" for local dev (no auth)
#   ADMIN_API_KEY          — legacy admin key (alternative to AUTH_DISABLED)
#   POSTGRES_HOST/PORT/USER/PASSWORD/DB — pgvector connection
#   APP_DB_NAME            — SQLAlchemy app database (default: mem0_app)

FROM python:3.12-slim

WORKDIR /app

# Copy the vendored mem0 server source (from mem0ai/mem0 server/ directory).
COPY server/ /app/

# Install server dependencies.
# psycopg-binary provides the libpq binding (python:slim has no system libpq).
RUN pip install --no-cache-dir -r requirements.txt psycopg-binary

# mem0's SQLite history store defaults to /app/history/history.db.
RUN mkdir -p /app/history

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

# Run alembic migrations first (creates auth/config tables in APP_DB),
# then start the FastAPI server. No --reload in production.
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]

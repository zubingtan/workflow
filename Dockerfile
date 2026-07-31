# syntax=docker/dockerfile:1
#
# T5 (#116 #121): single-command zero-config deployment image.
#
# Multi-stage build:
#   - prod-deps: pnpm install --prod (only runtime deps, no toolchain needed
#     because better-sqlite3 v11 ships linux-x64 prebuilt for Node ABI v127)
#   - build: full install + pnpm build → dist/
#   - runner: copy node_modules from prod-deps, dist/ from build, server/ from ctx
#
# Base image: node:22.23.1-bookworm-slim (NOT alpine — see D5 decision in #121).
# Pin to a specific patch version for reproducible builds; bump manually for
# security updates.

# ─── base (shared by all stages) ─────────────────────────────────────────────
FROM node:22.23.1-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
# Skip husky's prepare script during install — it shells out to `git config`
# which fails in Docker (no .git) and is irrelevant to image builds.
# husky's index.js checks `process.env.HUSKY === '0'` and short-circuits.
ENV HUSKY=0
RUN corepack enable
WORKDIR /app

# ─── prod-deps (runtime dependencies only) ───────────────────────────────────
# `--ignore-scripts` skips the `prepare` script (husky — not installed in prod
# and irrelevant to images) AND better-sqlite3's install script. We then
# explicitly `pnpm rebuild better-sqlite3` which runs its install script
# (`prebuild-install || node-gyp rebuild`) to fetch the prebuilt binary for
# Node ABI v127 on linux-x64 glibc — no python3/make/g++ needed.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts && \
    pnpm rebuild better-sqlite3

# ─── build (full deps + rsbuild build) ───────────────────────────────────────
# Needs devDeps (typescript, @rsbuild/core, etc.) to run `pnpm build`.
# `--ignore-scripts` here too: husky's prepare fails without .git, and the
# patched @flowgram.ai/runtime-js patch is applied by pnpm itself (not a script).
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build
# Build the mem0 extension (tsup → packages/pi-extension-mem0/dist) so the
# runner stage can ship it for pi's file discovery (#212 D15).
RUN pnpm --filter @flowgram.ai/pi-extension-mem0 build

# ─── runner (production image) ───────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# Override the default ~/.config/workflow so SQLite lands on a mountable path.
# docker-compose.yml bind-mounts a volume here so data survives `down && up`.
ENV WORKFLOW_DATA_DIR=/app/data

# node_modules from prod-deps (no devDeps, no toolchain).
COPY --from=prod-deps /app/node_modules ./node_modules
# dist/ from build (rsbuild static output, served by @hono/node-server/serve-static).
COPY --from=build /app/dist ./dist
# mem0 pi extension (#212 D15): installed at the fixed /opt/pi-extension-mem0
# path; the server symlinks it into each agent dir's extensions/ at run time.
COPY --from=build /app/packages/pi-extension-mem0/dist /opt/pi-extension-mem0
# Server code + package.json (for pnpm to resolve the node_modules layout).
COPY server/ ./server/
COPY package.json ./

# Data volume mount point (WORKFLOW_DATA_DIR).
RUN mkdir -p /app/data
VOLUME /app/data

# Prod default port (map #133 D1). docker-compose maps the same host port.
EXPOSE 4000
CMD ["node", "server/index.mjs"]

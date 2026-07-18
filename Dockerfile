FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.13.0
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/config ./config
# The worker runs outside Next's standalone bundle and imports this pure helper directly.
COPY --from=builder --chown=node:node /app/src/lib/runs/final-output.mjs ./src/lib/runs/final-output.mjs
COPY --from=dependencies --chown=node:node /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=dependencies --chown=node:node /app/node_modules/@mariozechner ./node_modules/@mariozechner
COPY --from=dependencies --chown=node:node /app/node_modules/postgres ./node_modules/postgres

USER node
CMD ["node", "server.js"]

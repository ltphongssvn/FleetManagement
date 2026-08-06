# Dockerfile - Shared multi-target build for Fleet pilot.
# One builder stage shared across api/worker/ops-web -> single pnpm install layer.
# Targets selected via `target:` in compose.yaml.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS builder
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile && \
    pnpm exec turbo run build --filter=@fleet/api... --filter=@fleet/main-worker --filter=@fleet/ops-web && \
    pnpm --filter=@fleet/api deploy --prod --no-optional \
      --config.inject-workspace-packages=true /tmp/api-deploy && \
    pnpm --filter=@fleet/main-worker deploy --prod --no-optional \
      --config.inject-workspace-packages=true /tmp/worker-deploy

FROM node:22-alpine AS api
WORKDIR /app
COPY --from=builder /tmp/api-deploy /app
COPY --from=builder /repo/apps/api/dist /app/dist
COPY --from=builder /repo/apps/api/src/database/migrations /app/dist/database/migrations
EXPOSE 3000
CMD ["node", "--import", "./dist/observability/otel-bootstrap.js", "dist/main.js"]

FROM node:22-alpine AS worker
WORKDIR /app
COPY --from=builder /tmp/worker-deploy /app
COPY --from=builder /repo/workers/main-worker/dist /app/dist
CMD ["node", "dist/main.js"]

FROM node:22-alpine AS ops-web
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
WORKDIR /repo
COPY --from=builder /repo/apps/ops-web/.next/standalone /repo/
COPY --from=builder /repo/apps/ops-web/.next/static /repo/apps/ops-web/.next/static
COPY --from=builder /repo/node_modules/.pnpm/@headlessui+react@2.2.10_react-dom@19.2.0_react@19.2.0__react@19.2.0 /repo/node_modules/.pnpm/@headlessui+react@2.2.10_react-dom@19.2.0_react@19.2.0__react@19.2.0
WORKDIR /repo/apps/ops-web
EXPOSE 3001
CMD ["node", "server.js"]

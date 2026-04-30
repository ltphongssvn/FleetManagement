# apps/api/Dockerfile
# Multi-stage build for @fleet/api. PDF Day-One: deploy on Fly.io.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/sync-protocol/package.json packages/sync-protocol/
COPY packages/test-fixtures/package.json packages/test-fixtures/
COPY workers/main-worker/package.json workers/main-worker/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build
COPY . .
RUN pnpm --filter @fleet/domain build && \
    pnpm --filter @fleet/sync-protocol build && \
    pnpm --filter @fleet/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/api /repo/apps/api
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]

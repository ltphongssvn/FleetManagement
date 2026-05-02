# apps/api/Dockerfile - Multi-stage build for Fleet API per PDF Day-One #10.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruned
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec turbo run build --filter=@fleet/api

FROM base AS runtime
COPY --from=pruned /repo/node_modules /repo/node_modules
COPY --from=pruned /repo/apps/api/dist /repo/apps/api/dist
COPY --from=pruned /repo/apps/api/package.json /repo/apps/api/package.json
COPY --from=pruned /repo/apps/api/node_modules /repo/apps/api/node_modules
WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["node", "--import", "./dist/observability/otel-bootstrap.js", "dist/main.js"]

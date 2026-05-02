# workers/main-worker/Dockerfile - Fleet worker per PDF Day-One #10.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruned
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec turbo run build --filter=@fleet/main-worker

FROM base AS runtime
COPY --from=pruned /repo/node_modules /repo/node_modules
COPY --from=pruned /repo/workers/main-worker/dist /repo/workers/main-worker/dist
COPY --from=pruned /repo/workers/main-worker/package.json /repo/workers/main-worker/package.json
COPY --from=pruned /repo/workers/main-worker/node_modules /repo/workers/main-worker/node_modules
WORKDIR /repo/workers/main-worker
CMD ["node", "dist/main.js"]

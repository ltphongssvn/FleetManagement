# apps/driver-app/Dockerfile
# Expo web dev server for end-to-end Docker Compose testing.
FROM node:22-alpine
RUN corepack enable && apk add --no-cache git
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fleet/sync-protocol --filter @fleet/observability --filter @fleet/domain build
WORKDIR /repo/apps/driver-app
EXPOSE 8081
# CI=1 forces Expo into non-interactive mode: without a TTY the interactive
# CLI reads EOF on stdin and exits 0, causing a boot-exit-restart loop.
# In CI mode Metro stays in the foreground as a long-running server.
ENV CI=1
CMD ["pnpm", "expo", "start", "--web", "--port", "8081", "--host", "lan"]

# apps/driver-app/Dockerfile
# Expo dev server for end-to-end Docker Compose testing.
# Serves BOTH the native JS bundle (for iOS/Android via Expo Go) and the
# web bundle (for browser-based verification) from the same Metro instance.
FROM node:22-alpine
RUN corepack enable && apk add --no-cache git
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fleet/sync-protocol --filter @fleet/observability --filter @fleet/domain build
WORKDIR /repo/apps/driver-app
# 8081 = Metro bundler (native + web). 19000/19001 = legacy Expo dev tunnel/devtools.
EXPOSE 8081 19000 19001
# CI=1 forces Expo into non-interactive mode: without a TTY the interactive
# CLI reads EOF on stdin and exits 0, causing a boot-exit-restart loop.
# In CI mode Metro stays in the foreground as a long-running server.
ENV CI=1
# No --web flag: Metro must serve native bundles so Expo Go on iOS/Android
# can download JS. --host lan binds Metro to the LAN interface inside the
# container; REACT_NATIVE_PACKAGER_HOSTNAME (set in compose) tells Metro
# which host to advertise to the phone.
CMD ["pnpm", "expo", "start", "--port", "8081", "--host", "lan"]

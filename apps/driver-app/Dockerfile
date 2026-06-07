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
# --offline: under CI=1 (non-interactive), after Metro finishes bundling the
# Expo CLI otherwise attempts an Expo-account / manifest-signing step that
# reads stdin, fails with "Input is required ... EXPO_TOKEN", and breaks the
# client handoff so Expo Go red-boxes ("Something went wrong"). --offline
# skips Expo server communication / manifest signing (2026 Expo non-
# interactive dev-server best practice) and does NOT affect the app's own
# API/network calls (EXPO_PUBLIC_API_URL still works).
#
# --clear: reset Metro's transform/Haste cache on every container start. A
# no-cache IMAGE rebuild updates the source in the image but does NOT bust
# Metro's RUNTIME cache, so after a code change Metro keeps serving the OLD
# bundle and the new code never reaches the device. --clear guarantees the
# served bundle reflects the freshly built image.
#
# No --host/--lan/--tunnel/--localhost flag: Expo SDK 55 rejects
# "Specify at most one of: --offline, --host, --tunnel, --lan, --localhost".
# Metro is told which LAN host to advertise to the phone via
# REACT_NATIVE_PACKAGER_HOSTNAME (set on the driver-app service in compose),
# so no host-mode CLI flag is needed. No --web flag: Metro serves native
# bundles so Expo Go on iOS/Android can download JS.
CMD ["pnpm", "expo", "start", "--port", "8081", "--offline", "--clear"]

// apps/ops-web/next.config.ts
// Next.js 16 App Router config. RSC default per Frozen Stack PDF.
// Version SSOT: read from package.json at build time (no version.ts duplication).
//
// VERSION-SKEW PROTECTION (2026, self-hosted on Railway behind Cloudflare):
// Server Actions derive their id + argument-encryption from the build. With
// multiple ops-web redeploys per day, a dispatcher browser tab from an earlier
// deploy POSTs a Server Action id the new build no longer recognises, and Next
// throws Failed to find Server Action -> caught by app/error.tsx -> the generic
// Vietnamese error page the dispatcher saw on a cancelled-order review. The
// durable fix is two-part and lives at the build boundary, not in app code:
//   1. NEXT_SERVER_ACTIONS_ENCRYPTION_KEY (stable base64 secret, wired as a
//      Dockerfile build ARG) keeps action-argument encryption identical across
//      rebuilds and replicas -- Next reads it from build env automatically, no
//      config key needed.
//   2. deploymentId (below), fed the per-deploy git SHA, lets Next detect a
//      genuine client/server version mismatch and force a hard reload instead
//      of a broken client-side navigation.
// serverActions.allowedOrigins lists the Cloudflare-fronted prod host so the
// action-origin CSRF check (same-origin by default) accepts requests proxied
// through xe.vominhchau.com.
import type { NextConfig } from 'next';
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
// Per-deploy identifier for version-skew detection. Sourced from the git SHA
// that the Dockerfile promotes to NEXT_PUBLIC_DEPLOYMENT_ID at build time.
// Undefined in local dev (no skew there) -> deploymentId simply stays unset.
const deploymentId = process.env['NEXT_PUBLIC_DEPLOYMENT_ID'];
const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  ...(deploymentId !== undefined && deploymentId.length > 0 ? { deploymentId } : {}),
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['xe.vominhchau.com'],
    },
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  headers() {
    return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]);
  },
};
export default config;

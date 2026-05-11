// apps/ops-web/next.config.ts
// Next.js 16 App Router config. RSC default per Frozen Stack PDF.
// Version SSOT: read from package.json at build time (no version.ts duplication).
import type { NextConfig } from 'next';
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  headers() {
    return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]);
  },
};

export default config;

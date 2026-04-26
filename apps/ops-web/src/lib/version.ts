// apps/ops-web/src/lib/version.ts
// Reads NEXT_PUBLIC_APP_VERSION injected from package.json via next.config.ts.
// Single source of truth: package.json. No hardcoded version literals.
export function getAppVersion(): string {
  return process.env['NEXT_PUBLIC_APP_VERSION'] ?? 'unknown';
}

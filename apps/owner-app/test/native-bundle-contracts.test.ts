// apps/owner-app/test/native-bundle-contracts.test.ts
// Structural regression pins for two production-bundle-only bugs that both
// shipped once in driver-app (fix commit: 'make native login work on
// SDK55/RN0.83 Bridgeless against prod') and were then reintroduced in
// owner-app's first iOS build (app flashed and closed at launch):
//
// 1. EXPO_PUBLIC_* env vars MUST be read as STATIC literal expressions
//    (process.env['EXPO_PUBLIC_X']). Expo's inlining transform cannot see a
//    dynamic process.env[name] access, so the value is undefined in the
//    production bundle; buildOwnerOidcConfig then throws during the first
//    render of AuthProvider and the app dies before painting.
// 2. The expo/fetch polyfill MUST be the first import of app/_layout.tsx:
//    RN 0.83 Bridgeless breaks the legacy whatwg-fetch path with an opaque
//    'Network request failed' on every request.
//
// Comments are stripped before matching so header prose can never satisfy
// (or false-flag) a structural assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function read(rel: string): string {
  return readFileSync(resolve(here, rel), 'utf-8');
}

describe('owner-app native bundle contracts', () => {
  it('use-auth reads all OIDC env vars as static literals (inlinable)', () => {
    const code = stripComments(read('../src/auth/use-auth.tsx'));
    expect(code).toContain("process.env['EXPO_PUBLIC_OIDC_ISSUER']");
    expect(code).toContain("process.env['EXPO_PUBLIC_OIDC_CLIENT_ID']");
    expect(code).toContain("process.env['EXPO_PUBLIC_OWNER_APP_SCHEME']");
  });

  it('use-auth has no dynamic process.env[name] access (invisible to inlining)', () => {
    const code = stripComments(read('../src/auth/use-auth.tsx'));
    const dynamicAccess = /process\.env\[(?!')/;
    expect(dynamicAccess.test(code)).toBe(false);
  });

  it('root layout imports the expo/fetch polyfill before anything else', () => {
    const code = stripComments(read('../app/_layout.tsx'));
    const firstStatement = code.trim().split('\n')[0] ?? '';
    expect(firstStatement).toContain("import '../src/polyfills/install-fetch-polyfill.js'");
  });

  it('the polyfill replaces the global fetch with expo/fetch', () => {
    const code = stripComments(read('../src/polyfills/install-fetch-polyfill.ts'));
    expect(code).toContain("from 'expo/fetch'");
    expect(code).toContain('.fetch =');
  });
});

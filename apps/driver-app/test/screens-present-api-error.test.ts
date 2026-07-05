// apps/driver-app/test/screens-present-api-error.test.ts
// RED-first (Phase 3.4): source-assertion wiring guard (house pattern, like
// login-form-testid.test.ts) over EVERY screen that previously rendered raw
// error text. The presenter only helps if screens actually route through it,
// so this test reads each screen source and asserts: (a) it imports
// presentApiError, (b) it never renders error.message / err.message /
// errorMsg directly. This is what makes the raw "POST <url> HTTP 400" banner
// class UNREPRESENTABLE going forward: reintroducing a raw render site in
// these files fails the suite. Fails RED until the five screens are rewired.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = (rel: string): string =>
  readFileSync(resolve(here, '../app/(app)', rel), 'utf8');

const SCREENS = ['assignments.tsx', 'history.tsx', 'completed.tsx', 'commands.tsx'] as const;

describe('driver-app screens render errors only through presentApiError', () => {
  it.each([...SCREENS])('%s imports the presenter', (file) => {
    const src = app(file);
    expect(src.includes('presentApiError')).toBe(true);
    expect(src.includes('errors/present-api-error')).toBe(true);
  });

  it.each([...SCREENS])('%s never renders raw error text', (file) => {
    const src = app(file);
    expect(src.includes('.error.message')).toBe(false);
    expect(src.includes('err.message')).toBe(false);
    expect(src.includes('error.message')).toBe(false);
    // Ban the raw empty-string fallback specifically; the presenter-based
    // fallback (errorMsg ?? presentApiError(undefined)) is the REQUIRED form.
    expect(src.includes("errorMsg ?? ''")).toBe(false);
  });

  it('assignments.tsx routes BOTH sites (query + lifecycle banner) through the presenter', () => {
    const src = app('assignments.tsx');
    const count = src.split('presentApiError(').length - 1;
    expect(count >= 2).toBe(true);
  });

  it('commands.tsx presents socket failures instead of raw err.message state', () => {
    const src = app('commands.tsx');
    expect(src.includes('setErrorMsg(presentApiError(')).toBe(true);
    expect(src.includes('errorMsg ?? presentApiError(undefined)')).toBe(true);
  });
});

// apps/ops-web/test/auth-session.test.ts
// RED: session decoding lives inline in app/page.tsx, where it is untestable and
// untested -- a four-branch JWT parser behind a bare catch, invisible to the
// gate because vitest excludes src/app/**. The new /admin layout needs the same
// username, and a second copy would be an Axis-2 violation: two owners of the
// fleet_session shape. Extracting to features/auth/session.ts gives one owner
// and puts the parser under the 90/90/90/90 perFile gate for the first time.
//
// Axis-1: the JWT payload is UNTRUSTED input from a cookie. develop casts it
// with JSON.parse(...) as {...}, which asserts a shape rather than checking it,
// so a token whose payload is valid JSON but not an object (a bare string, an
// array, a number) reaches property access unchallenged. These tests pin the
// safeParse behaviour that replaces the cast.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
}));
vi.mock('server-only', () => ({}));

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function jwtWith(claims: Record<string, unknown>): string {
  return 'header.' + b64(claims) + '.signature';
}

describe('decodeUsername', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.resetModules();
  });

  it('prefers preferred_username over sub', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    expect(decodeUsername(jwtWith({ preferred_username: 'dieu-phoi', sub: 'uuid-1' }))).toBe(
      'dieu-phoi',
    );
  });

  it('falls back to sub when preferred_username is absent', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    expect(decodeUsername(jwtWith({ sub: 'uuid-1' }))).toBe('uuid-1');
  });

  it('returns undefined when neither claim is present', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    expect(decodeUsername(jwtWith({ scope: 'openid' }))).toBeUndefined();
  });

  it('returns undefined when the token is absent', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    expect(decodeUsername(undefined)).toBeUndefined();
  });

  it('returns undefined when the token has no payload segment', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    expect(decodeUsername('single-segment')).toBeUndefined();
  });

  it('returns undefined when the payload is not valid JSON', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    const junk = Buffer.from('not-json', 'utf8').toString('base64url');
    expect(decodeUsername('header.' + junk + '.sig')).toBeUndefined();
  });

  it('returns undefined when the payload is valid JSON but not an object', async () => {
    const { decodeUsername } = await import('@/features/auth/session');
    expect(decodeUsername('header.' + b64('a-bare-string') + '.sig')).toBeUndefined();
  });
});

describe('getSessionUsername', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.resetModules();
  });

  it('reads the username from the fleet_session cookie', async () => {
    cookieGet.mockReturnValue({ value: jwtWith({ preferred_username: 'dieu-phoi' }) });
    const { getSessionUsername } = await import('@/features/auth/session');
    await expect(getSessionUsername()).resolves.toBe('dieu-phoi');
    expect(cookieGet).toHaveBeenCalledWith('fleet_session');
  });

  it('returns undefined when no session cookie is present', async () => {
    cookieGet.mockReturnValue(undefined);
    const { getSessionUsername } = await import('@/features/auth/session');
    await expect(getSessionUsername()).resolves.toBeUndefined();
  });
});

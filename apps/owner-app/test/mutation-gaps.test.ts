// apps/owner-app/test/mutation-gaps.test.ts
// Assertions for behaviour the existing suite EXERCISED but never CHECKED.
//
// Every case below was found by mutation testing, not by reading the code:
// Stryker changed something real and the whole suite stayed green. That is the
// precise failure coverage cannot see -- these lines all had coverage, and the
// tests that ran them asserted something else.
//
// None of these is an equivalent mutant. Each one changes observable behaviour:
// a malformed discovery URL, a crash on a browser without localStorage, funnel
// rows keyed by empty strings, an error message that names no endpoint, and a
// cache that refetches 1000x more often than intended.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildOwnerOidcConfig } from '../src/auth/oidc-config.js';
import { presentAdoption } from '../src/dashboard/adoption-presenter.js';
import { fetchAdoptionMetrics } from '../src/dashboard/adoption-client.js';
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';
// import TYPE only: erased at compile time, so this does NOT load the real
// module (whose react-native dependency is Flow source vitest cannot parse).
// It exists so the dynamic-import helper below can name its return type
// without an inline import(), which consistent-type-imports forbids.
import type * as TokenStorage from '../src/auth/token-storage.js';
import { createQueryClient } from '../src/data/query-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALID_ENV = {
  EXPO_PUBLIC_OIDC_ISSUER: 'https://idp.test/realms/fleet',
  EXPO_PUBLIC_OIDC_CLIENT_ID: 'owner-app',
  EXPO_PUBLIC_OWNER_APP_SCHEME: 'fleetowner',
};

describe('buildOwnerOidcConfig normalises the issuer', () => {
  // Kills the Regex mutant `/\/+$/` -> `/\/$/`. ONE trailing slash is stripped
  // by both forms, which is why every existing test missed this -- only a
  // DOUBLE slash distinguishes them. A misconfigured issuer with a trailing
  // slash pasted twice would otherwise produce
  // https://idp.test/realms/fleet//.well-known/... and discovery would 404.
  it('strips MULTIPLE trailing slashes, not just one', () => {
    const c = buildOwnerOidcConfig({
      ...VALID_ENV,
      EXPO_PUBLIC_OIDC_ISSUER: 'https://idp.test/realms/fleet///',
    });
    expect(c.discoveryUrl).toBe('https://idp.test/realms/fleet/.well-known/openid-configuration');
  });

  // Kills the StringLiteral mutant on the replacement argument ('' -> a
  // sentinel): with a trailing slash present, the replacement value becomes
  // visible in the output.
  it('replaces the trailing slash with nothing, not with filler', () => {
    const c = buildOwnerOidcConfig({
      ...VALID_ENV,
      EXPO_PUBLIC_OIDC_ISSUER: 'https://idp.test/realms/fleet/',
    });
    expect(c.discoveryUrl).toBe('https://idp.test/realms/fleet/.well-known/openid-configuration');
  });
});

describe('token-storage survives a web environment with no localStorage', () => {
  // Kills three OptionalChaining mutants (`webStorage()?.` -> `webStorage().`).
  // webStorage() returns null when globalThis has no localStorage -- an SSR or
  // sandboxed web context -- and without the optional chain each of these
  // throws "Cannot read properties of null". The existing tests always
  // installed a localStorage, so the guard was never the thing under test.
  //
  // react-native is doMock'd BEFORE the dynamic import, matching
  // token-storage.test.ts: the real package is Flow source that rolldown
  // cannot parse, and importing it directly fails with "Flow is not supported".
  async function loadModuleOnWeb(): Promise<typeof TokenStorage> {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    // expo-secure-store is imported at MODULE LOAD regardless of platform, and
    // the real package reaches expo-modules-core, which reads the React Native
    // __DEV__ global that does not exist under vitest. Mocked for the same
    // reason token-storage.test.ts mocks it.
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: vi.fn(() => Promise.resolve(null)),
      setItemAsync: vi.fn(() => Promise.resolve(undefined)),
      deleteItemAsync: vi.fn(() => Promise.resolve(undefined)),
    }));
    // The condition under test: a web context with NO localStorage at all.
    vi.stubGlobal('localStorage', undefined);
    return import('../src/auth/token-storage.js');
  }

  it('loadToken returns null instead of throwing when localStorage is absent', async () => {
    const { loadToken } = await loadModuleOnWeb();
    await expect(loadToken()).resolves.toBeNull();
  });

  it('saveToken is a no-op instead of throwing when localStorage is absent', async () => {
    const { saveToken } = await loadModuleOnWeb();
    await expect(saveToken({ accessToken: 'a', issuedAt: 1 })).resolves.toBeUndefined();
  });

  it('clearToken is a no-op instead of throwing when localStorage is absent', async () => {
    const { clearToken } = await loadModuleOnWeb();
    await expect(clearToken()).resolves.toBeUndefined();
  });
});

describe('presentAdoption funnel rows carry stable keys', () => {
  const METRICS = {
    totalDrivers: 10,
    appInstalled: 6,
    notInstalled: 4,
    activeToday: 3,
    day: '2026-08-23',
  } as OwnerAdoptionMetrics;

  // Kills four StringLiteral mutants (`key: 'total'` -> `key: ''` etc). The
  // existing tests asserted the LABELS and the VALUES but never the keys, so
  // every key could collapse to an empty string and stay green -- which would
  // break any consumer using key as a React list key or a click target.
  it('names each row with its own non-empty key', () => {
    const rows = presentAdoption(METRICS).rows;
    expect(rows.map((r) => r.key)).toEqual(['total', 'installed', 'notInstalled', 'active']);
  });

  it('keeps every key distinct, so rows cannot collide', () => {
    const keys = presentAdoption(METRICS).rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('fetchAdoptionMetrics reports WHICH endpoint failed', () => {
  // Kills two StringLiteral mutants in the thrown message. The existing test
  // asserted only that it rejects, so the message could lose the endpoint and
  // the status separator and nothing noticed -- leaving an operator with
  // "503 Service Unavailable" and no idea which call produced it.
  it('names the endpoint and the status in the error', async () => {
    const res = { ok: false, status: 503, statusText: 'Service Unavailable' };
    await expect(
      fetchAdoptionMetrics({
        apiUrl: 'https://api.test',
        bearerToken: () => 't',
        fetchFn: () => Promise.resolve(res as unknown as Response),
      }),
    ).rejects.toThrow('/owner/metrics/adoption HTTP 503 Service Unavailable');
  });
});

describe('createQueryClient staleTime is one minute', () => {
  // Kills the Arithmetic mutant `60 * 1000` -> `60 / 1000`. The existing test
  // asserted only that staleTime is non-zero, and 0.06 is non-zero -- so a
  // cache that goes stale 1000x sooner than intended passed. Asserting the
  // VALUE is what pins the intent stated in the source comment.
  it('is exactly 60000 ms, not merely non-zero', () => {
    const opts = createQueryClient().getDefaultOptions().queries;
    expect(opts?.staleTime).toBe(60_000);
  });
});

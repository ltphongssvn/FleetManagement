// apps/owner-app/test/api-url-guards.test.ts
// The DEFENSIVE guards in getWebHostname + getApiUrl, which nothing exercised.
//
// WHY THIS FILE EXISTS. api-url.test.ts and api-url-web-origin.test.ts cover
// the happy paths: env set, env unset, the emulator-host rewrite on web, no
// rewrite on native. Mutation testing showed the REMAINING branches were never
// reached -- api-url.ts scored 76.92%, the worst file in the package, with 11
// survivors and 1 uncovered mutant.
//
// Every survivor was a guard against a MALFORMED environment: a window that is
// not an object, a null window, a location that is not an object, an absent or
// empty hostname. Each returns a SAFE fallback instead of throwing, which is
// the whole point of writing them -- an owner-app that crashes on boot because
// location.hostname was '' is worse than one that keeps the inlined URL. A
// guard nothing tests is a guard nobody knows still works: Stryker replaced
// `loc === null` with `false` and every test still passed.
//
// STUBBING VIA vi, NOT BY HAND. An earlier draft assigned to process.env and
// removed the key afterwards, which trips no-dynamic-delete and leaks state
// between tests when an assertion throws before the cleanup line. vi.stubEnv +
// vi.stubGlobal are the APIs Vitest provides for exactly this, and the matching
// unstub calls restore everything in afterEach whether the test passed or not.
// vi.stubEnv(name, undefined) is the documented way to make a variable UNSET,
// which is what the fallback path needs.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getApiUrl } from '../src/config/api-url.js';

const ENV_KEY = 'EXPO_PUBLIC_API_URL';
const EMULATOR_URL = 'http://10.0.2.2:3000';
const FALLBACK = 'http://localhost:3000';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getWebHostname guards: a malformed window never throws', () => {
  // Kills `typeof win !== 'object'` -> false, and the LogicalOperator flip.
  it('ignores a window that is not an object', () => {
    vi.stubGlobal('window', 'not-an-object');
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe(EMULATOR_URL);
  });

  // Kills `win === null` -> false. typeof null is 'object', so this branch is
  // reachable ONLY with an explicit null -- which is exactly why it exists.
  it('ignores a null window', () => {
    vi.stubGlobal('window', null);
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe(EMULATOR_URL);
  });

  // Kills `typeof loc !== 'object'` -> false and its LogicalOperator flip.
  it('ignores a window whose location is not an object', () => {
    vi.stubGlobal('window', { location: 'nope' });
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe(EMULATOR_URL);
  });

  it('ignores a window whose location is null', () => {
    vi.stubGlobal('window', { location: null });
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe(EMULATOR_URL);
  });

  // Kills `host.length > 0` -> `>= 0` and the `true &&` conditional. An empty
  // hostname would otherwise rewrite the URL to http:/// -- silently broken.
  it('ignores an empty hostname rather than rewriting to an empty host', () => {
    vi.stubGlobal('window', { location: { hostname: '' } });
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe(EMULATOR_URL);
  });

  // Kills `typeof host === 'string'` -> true.
  it('ignores a non-string hostname', () => {
    vi.stubGlobal('window', { location: { hostname: 42 } });
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe(EMULATOR_URL);
  });

  // Kills THREE mutants on `typeof host === 'string' && host.length > 0`:
  // the `||` flip, the `&& true` collapse, and `> 0` -> `>= 0`. Each makes an
  // EMPTY hostname read as a usable host.
  //
  // Asserting getApiUrl() with the emulator URL cannot distinguish them: an
  // empty hostname assigned to URL.hostname is a no-op, so the rewritten URL
  // comes back identical and every mutant looks equivalent. Verified by
  // running the guard chain against both variants over every window shape --
  // the outputs differ ONLY on an empty hostname, and only before the URL
  // round-trip hides it.
  //
  // A NON-EMULATOR env URL exposes it. Returning undefined means "not on web,
  // do not rewrite" and the raw value is returned untouched; returning ''
  // means "on web" and the code proceeds into the URL branch. With a hostname
  // that is not 10.0.2.2 the branch leaves the URL alone but NORMALISES it
  // through URL.toString(), so the trailing-slash form differs observably.
  it('treats an empty hostname as absent, not as a usable host', () => {
    vi.stubGlobal('window', { location: { hostname: '' } });
    // AN EMULATOR URL WITH A TRAILING SLASH is what separates the variants.
    //
    // A non-emulator URL cannot: both paths fall through to `return raw` and
    // produce identical output, which is why an earlier version of this test
    // failed to kill anything. Here the difference is observable end to end --
    //   guard returns undefined (correct): getApiUrl returns raw UNCHANGED,
    //     trailing slash intact, because hostname === undefined short-circuits
    //     before the URL branch;
    //   guard returns '' (mutated):        getApiUrl enters the rewrite branch,
    //     assigns an empty hostname (a no-op on URL) and then runs
    //     .replace(/\/$/, ''), which STRIPS the trailing slash.
    // So the slash is the witness: present means the guard rejected the empty
    // hostname, absent means it accepted it.
    vi.stubEnv(ENV_KEY, 'http://10.0.2.2:3000/');
    expect(getApiUrl()).toBe('http://10.0.2.2:3000/');
  });
});

describe('getApiUrl guards: a malformed env never throws', () => {
  // Kills the NoCoverage mutant on the catch block. new URL() throws on a
  // non-absolute value, and the guard returns the raw string rather than
  // crashing the app at startup.
  it('returns the raw value when it is not a parseable URL', () => {
    vi.stubGlobal('window', { location: { hostname: 'example.test' } });
    vi.stubEnv(ENV_KEY, 'not a url at all');
    expect(getApiUrl()).toBe('not a url at all');
  });

  // The unset path, via the documented undefined form rather than a delete.
  it('falls back to the dev URL when the variable is unset', () => {
    vi.stubEnv(ENV_KEY, undefined);
    expect(getApiUrl()).toBe(FALLBACK);
  });

  // The rewrite still works -- proving the guards above did not disable it.
  it('still rewrites the emulator host when everything is well formed', () => {
    vi.stubGlobal('window', { location: { hostname: 'example.test' } });
    vi.stubEnv(ENV_KEY, EMULATOR_URL);
    expect(getApiUrl()).toBe('http://example.test:3000');
  });
});

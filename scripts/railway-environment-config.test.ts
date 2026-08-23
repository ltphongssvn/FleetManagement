// scripts/railway-environment-config.test.ts
// The shared boundary module carries the retry, classification and parse logic
// BOTH Railway guards depend on. Untested shared code under two gates is worse
// than untested duplicated code: one regression silently disarms both.
//
// The reader takes injected run/sleep ports precisely so this suite exercises
// the retry paths offline, with no Railway CLI and no wall-clock waiting.
import { describe, expect, it, vi } from 'vitest';
import {
  RailwayConfigShapeError,
  RailwayConfigUnreadableError,
  type RailwayService,
  fetchEnvironmentConfig,
  isTransientCliError,
  parseEnvironmentConfig,
  readVariable,
} from './railway-environment-config.js';

const noSleep = (): void => undefined;

/** Narrow a parsed service by ASSERTING rather than by non-null assertion. A
 *  `!` silences the type system; if the parse ever stopped returning the
 *  service, the test would die on an opaque TypeError instead of saying which
 *  expectation failed. */
function serviceOf(payload: unknown, key: string): RailwayService {
  const svc = parseEnvironmentConfig(payload).services?.[key];
  if (svc === undefined) {
    throw new Error(`expected service ${key} in the parsed payload`);
  }
  return svc;
}

describe('isTransientCliError', () => {
  it.each([
    'error decoding response body',
    'expected value at line 1 column 1',
    'Failed to fetch',
    'HTTP 429 Too Many Requests',
    'rate limit exceeded',
    'upstream returned 503',
    'request timed out',
    'ECONNRESET',
  ])('classifies %s as transient', (message) => {
    expect(isTransientCliError(message)).toBe(true);
  });

  it.each(['Unauthorized: invalid token', 'command not found: railway', 'No linked project found'])(
    'does NOT classify %s as transient',
    (message) => {
      // These are real tooling errors. Misclassifying one as transient would
      // soft-skip the gate to exit 0 -- a guard passing because it never ran.
      expect(isTransientCliError(message)).toBe(false);
    },
  );
});

describe('parseEnvironmentConfig', () => {
  it('accepts a payload carrying only the fields the guards read', () => {
    const parsed = parseEnvironmentConfig({
      services: { a: { variables: { KC_DB: 'postgres' } } },
    });
    expect(Object.keys(parsed.services ?? {})).toEqual(['a']);
  });

  it('accepts UNKNOWN extra fields rather than breaking the gate', () => {
    // Loose on purpose: a strict schema would fail the deploy the moment
    // Railway adds a field, which is a non-reason to block a deploy.
    const parsed = parseEnvironmentConfig({
      services: { a: { variables: {}, somethingNew: true } },
      alsoNew: 42,
    });
    expect(parsed.services).toBeDefined();
  });

  it('accepts both variable forms: bare string and { value }', () => {
    const svc = serviceOf(
      { services: { a: { variables: { X: 'plain', Y: { value: 'wrapped' } } } } },
      'a',
    );
    expect(readVariable(svc, 'X')).toBe('plain');
    expect(readVariable(svc, 'Y')).toBe('wrapped');
  });

  it('returns null for an absent or value-less variable', () => {
    const svc = serviceOf({ services: { a: { variables: { Z: {} } } } }, 'a');
    expect(readVariable(svc, 'Z')).toBeNull();
    expect(readVariable(svc, 'MISSING')).toBeNull();
  });

  it('reads the deploy fields the memory guard depends on', () => {
    const svc = serviceOf(
      {
        services: {
          a: {
            variables: { KC_DB: 'postgres' },
            deploy: { limitOverride: { containers: { memoryBytes: 1_000_000_000 } } },
          },
        },
      },
      'a',
    );
    expect(svc.deploy?.limitOverride?.containers?.memoryBytes).toBe(1_000_000_000);
  });

  it('THROWS on a moved contract rather than yielding an empty result', () => {
    // The whole point: a cast would still "succeed" here, the walk would find
    // nothing, and the guard would report "scanned 0 service(s)" while passing
    // a deploy it never inspected.
    expect(() => parseEnvironmentConfig({ services: 'not-an-object' })).toThrow(
      RailwayConfigShapeError,
    );
  });
});

describe('fetchEnvironmentConfig', () => {
  it('returns the parsed payload on first success', () => {
    const run = vi.fn(() => '{"services":{}}');
    expect(fetchEnvironmentConfig({ run, sleep: noSleep })).toEqual({ services: {} });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries a transient error and succeeds', () => {
    const run = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw new Error('Failed to fetch');
      })
      .mockImplementationOnce(() => '{"services":{}}');
    expect(fetchEnvironmentConfig({ run, sleep: noSleep })).toEqual({ services: {} });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('backs off linearly between attempts', () => {
    const sleep = vi.fn<(ms: number) => void>();
    const run = vi.fn(() => {
      throw new Error('429');
    });
    expect(() => fetchEnvironmentConfig({ run, sleep, maxAttempts: 3, baseDelayMs: 100 })).toThrow(
      RailwayConfigUnreadableError,
    );
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it('gives up as UNREADABLE after the final transient attempt', () => {
    const run = vi.fn(() => {
      throw new Error('rate limit');
    });
    expect(() => fetchEnvironmentConfig({ run, sleep: noSleep, maxAttempts: 2 })).toThrow(
      RailwayConfigUnreadableError,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('RETHROWS a non-transient error immediately, never retrying', () => {
    // Bad auth must reach the caller as a tooling error, not be softened into a
    // neutral skip after four pointless attempts.
    const run = vi.fn(() => {
      throw new Error('Unauthorized: invalid token');
    });
    expect(() => fetchEnvironmentConfig({ run, sleep: noSleep })).toThrow('Unauthorized');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('treats non-JSON stdout as transient (railwayapp/cli#647)', () => {
    const run = vi
      .fn<() => string>()
      .mockImplementationOnce(() => '<html>502 Bad Gateway</html>')
      .mockImplementationOnce(() => '{"services":{}}');
    expect(fetchEnvironmentConfig({ run, sleep: noSleep })).toEqual({ services: {} });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up as UNREADABLE when stdout never becomes JSON', () => {
    const run = vi.fn(() => 'still not json');
    expect(() => fetchEnvironmentConfig({ run, sleep: noSleep, maxAttempts: 2 })).toThrow(
      RailwayConfigUnreadableError,
    );
  });

  it('reports each retry so a flaky read is visible in CI logs', () => {
    const onRetry = vi.fn();
    const run = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw new Error('ETIMEDOUT');
      })
      .mockImplementationOnce(() => '{"services":{}}');
    fetchEnvironmentConfig({ run, sleep: noSleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// packages/observability/test/sentry-scrub.property.test.ts
// Property-based + edge-case tests for the PII scrubber.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scrub, scrubString, scrubEvent, REDACTED, UNSCRUBBABLE } from '../src/index.js';

describe('scrub - property-based', () => {
  it('is idempotent: scrub(scrub(x)) === scrub(x) for JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const once = scrub(v);
        const twice = scrub(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it('never throws on arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(() => { scrub(v); }).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('does not mutate arbitrary input objects', () => {
    fc.assert(
      fc.property(fc.object(), (v) => {
        const snapshot: unknown = structuredClone(v);
        scrub(v);
        expect(v).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it('redacts any key matching PII regex regardless of value shape', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const out = scrub({ password: v }) as Record<string, unknown>;
        expect(out['password']).toBe(REDACTED);
      }),
      { numRuns: 50 },
    );
  });
});

describe('scrubString - property-based', () => {
  it('returns a string for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(typeof scrubString(s)).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  it('is idempotent on strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(scrubString(scrubString(s))).toBe(scrubString(s));
      }),
      { numRuns: 100 },
    );
  });
});

describe('scrub - non-serializable values', () => {
  it('passes through symbols (typeof symbol -> not object)', () => {
    const sym = Symbol('s');
    expect(scrub(sym)).toBe(sym);
  });

  it('passes through bigints', () => {
    expect(scrub(123n)).toBe(123n);
  });

  it('passes through functions', () => {
    const fn = (): number => 1;
    expect(scrub(fn)).toBe(fn);
  });

  it('handles objects containing symbols/bigints/functions in values', () => {
    const sym = Symbol('s');
    const fn = (): void => undefined;
    const out = scrub({ a: sym, b: 1n, c: fn, password: 'p' }) as Record<string, unknown>;
    expect(out['a']).toBe(sym);
    expect(out['b']).toBe(1n);
    expect(out['c']).toBe(fn);
    expect(out['password']).toBe(REDACTED);
  });

  it('handles symbol-keyed properties (Object.entries skips them - documented)', () => {
    const sym = Symbol('hidden');
    const input = { visible: 'v', [sym]: 'secret' };
    const out = scrub(input) as Record<string, unknown>;
    expect(out['visible']).toBe('v');
    // Symbol-keyed entries are not enumerated by Object.entries; this is intentional.
    expect(Object.getOwnPropertySymbols(out)).toEqual([]);
  });

  it('returns UNSCRUBBABLE on object whose getter throws', () => {
    const trap = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(trap, 'boom', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(scrub(trap)).toBe(UNSCRUBBABLE);
  });
});

describe('scrubEvent - property-based purity', () => {
  it('does not mutate event for arbitrary message strings', () => {
    fc.assert(
      fc.property(fc.string(), (msg) => {
        const input = { message: msg };
        const snapshot = { message: msg };
        scrubEvent(input);
        expect(input).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});

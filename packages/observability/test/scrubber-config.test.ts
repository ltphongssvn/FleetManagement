// packages/observability/test/scrubber-config.test.ts
import { describe, it, expect } from 'vitest';
import { validateScrubberConfig, scrubberConfigSchema } from '../src/scrubber-config.ts';
import { isPiiHeader, assertPiiHeader, type PiiHeaderName } from '../src/sentry-scrub.ts';
import { createScrubber, REDACTED } from '../src/sentry-scrub.ts';

describe('scrubberConfigSchema', () => {
  it('accepts empty config', () => {
    expect(validateScrubberConfig({})).toEqual({});
  });

  it('accepts full valid config', () => {
    const cfg = {
      depthLimit: 4,
      piiKeyPattern: /secret/i,
      piiHeaders: ['x-custom'],
      piiValuePatterns: [/foo/g],
      onScrubError: (): void => undefined,
    };
    const parsed = validateScrubberConfig(cfg);
    expect(parsed.depthLimit).toBe(4);
  });

  it('rejects depthLimit > 50', () => {
    expect(() => validateScrubberConfig({ depthLimit: 999 })).toThrow();
  });

  it('rejects negative depthLimit', () => {
    expect(() => validateScrubberConfig({ depthLimit: -1 })).toThrow();
  });

  it('rejects non-RegExp piiKeyPattern', () => {
    expect(() => validateScrubberConfig({ piiKeyPattern: 'not-a-regex' })).toThrow();
  });

  it('rejects non-array piiValuePatterns', () => {
    expect(() => validateScrubberConfig({ piiValuePatterns: 'nope' })).toThrow();
  });

  it('rejects empty string in piiHeaders', () => {
    expect(() => validateScrubberConfig({ piiHeaders: [''] })).toThrow();
  });

  it('rejects unknown keys (strict mode)', () => {
    expect(() => validateScrubberConfig({ unknownKey: 1 })).toThrow();
  });

  it('exposes underlying schema', () => {
    expect(scrubberConfigSchema).toBeDefined();
  });
});

describe('createScrubber with custom config', () => {
  it('uses custom piiKeyPattern when provided', () => {
    const fn = createScrubber({ piiKeyPattern: /^topsecret$/ });
    const out = fn({ topsecret: 'hide', password: 'keep' }) as Record<string, unknown>;
    expect(out['topsecret']).toBe(REDACTED);
    expect(out['password']).toBe('keep');
  });

  it('uses custom piiValuePatterns when provided', () => {
    const fn = createScrubber({ piiValuePatterns: [/CUSTOM-\d+/g] });
    expect(fn('id is CUSTOM-123 here')).toBe('id is [redacted] here');
  });

  it('falls back to defaults when overrides omitted', () => {
    const fn = createScrubber();
    const out = fn({ password: 'p' }) as Record<string, unknown>;
    expect(out['password']).toBe(REDACTED);
  });
});

describe('PiiHeaderName branded type + validator', () => {
  it('isPiiHeader returns true for canonical headers', () => {
    expect(isPiiHeader('authorization')).toBe(true);
    expect(isPiiHeader('cookie')).toBe(true);
    expect(isPiiHeader('set-cookie')).toBe(true);
    expect(isPiiHeader('x-api-key')).toBe(true);
  });

  it('isPiiHeader returns false for unknown headers', () => {
    expect(isPiiHeader('user-agent')).toBe(false);
    expect(isPiiHeader('x-trace')).toBe(false);
    expect(isPiiHeader('')).toBe(false);
  });

  it('isPiiHeader matches case-insensitively', () => {
    expect(isPiiHeader('Authorization')).toBe(true);
    expect(isPiiHeader('SET-COOKIE')).toBe(true);
  });

  it('assertPiiHeader returns branded value for canonical input', () => {
    const h: PiiHeaderName = assertPiiHeader('authorization');
    expect(h).toBe('authorization');
  });

  it('assertPiiHeader throws for non-canonical input', () => {
    expect(() => assertPiiHeader('not-pii')).toThrow();
  });
});


// packages/test-fixtures/test/provenance-fixtures.test.ts
// The factory exists to make an invalid commit sha UNREACHABLE in tests, so it
// must itself be proven valid -- an unverified factory is only a tidier literal.
import { describe, it, expect } from 'vitest';
import { testSha, testShortSha, INVALID_SHA_FIXTURES } from '../src/provenance-fixtures.js';

const SHA_RE = /^[0-9a-f]{40}$/;

describe('testSha', () => {
  it('emits a 40-char lowercase hex sha, the only shape git produces', () => {
    expect(testSha()).toMatch(SHA_RE);
  });

  it('is deterministic, so a failure reproduces exactly', () => {
    expect(testSha(7)).toBe(testSha(7));
  });

  it('gives distinct shas for distinct seeds, for precedence tests', () => {
    expect(testSha(1)).not.toBe(testSha(2));
  });

  it('stays valid across a spread of seeds', () => {
    for (const seed of [0, 1, 2, 42, 999, 123456]) {
      expect(testSha(seed)).toMatch(SHA_RE);
    }
  });
});

describe('testShortSha', () => {
  it('is derived from the sha, never restated', () => {
    expect(testShortSha(3)).toBe(testSha(3).slice(0, 7));
  });
});

describe('INVALID_SHA_FIXTURES', () => {
  // Each must genuinely FAIL the shape, or a negative test would silently pass.
  it('holds only values that are not valid shas', () => {
    for (const value of Object.values(INVALID_SHA_FIXTURES)) {
      expect(value).not.toMatch(SHA_RE);
    }
  });

  it('covers the real mistakes: tag, truncation, uppercase, blank', () => {
    expect(INVALID_SHA_FIXTURES.releaseTag).toBe('v2.65.0');
    expect(INVALID_SHA_FIXTURES.truncated.length).toBeLessThan(40);
    expect(INVALID_SHA_FIXTURES.uppercase).toBe(testSha(1).toUpperCase());
    expect(INVALID_SHA_FIXTURES.blank).toBe('');
  });
});

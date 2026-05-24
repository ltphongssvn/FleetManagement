// apps/api/test/sentry-bootstrap.test.ts
import { describe, it, expect } from 'vitest';
import { parseSampleRate } from '../src/observability/sentry-bootstrap.js';

describe('parseSampleRate', () => {
  it('returns 0.1 default when undefined', () => {
    expect(parseSampleRate(undefined)).toBe(0.1);
  });
  it('returns 0.1 when empty string parses to 0 (valid 0)', () => {
    expect(parseSampleRate('0')).toBe(0);
  });
  it('returns 0.1 default when NaN', () => {
    expect(parseSampleRate('not-a-number')).toBe(0.1);
  });
  it('returns 0.1 default when negative', () => {
    expect(parseSampleRate('-0.5')).toBe(0.1);
  });
  it('returns 0.1 default when > 1', () => {
    expect(parseSampleRate('1.5')).toBe(0.1);
  });
  it('returns 0.1 default when Infinity', () => {
    expect(parseSampleRate('Infinity')).toBe(0.1);
  });
  it('accepts valid 0', () => {
    expect(parseSampleRate('0')).toBe(0);
  });
  it('accepts valid 1', () => {
    expect(parseSampleRate('1')).toBe(1);
  });
  it('accepts valid mid-range', () => {
    expect(parseSampleRate('0.25')).toBe(0.25);
  });
});

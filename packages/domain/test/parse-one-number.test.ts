// packages/domain/test/parse-one-number.test.ts
// Characterization tests for parseOneNumber, relocated into @fleet/domain by the
// extract-parse-one-number codemod. It is the single gate that turns an OCR'd
// Phiếu Cân net-weight string (Vietnamese grouped thousands "1.234,56", optional
// "kg" suffix) into a number, shared by the API extraction service and the board
// projection so web and mobile never disagree on a parsed weight. perFile 90/90.
import { describe, it, expect } from 'vitest';
import { parseOneNumber } from '../src/number-format/parse-one-number.js';

describe('parseOneNumber', () => {
  it('parses a plain integer run', () => {
    expect(parseOneNumber('1234')).toBe(1234);
  });

  it('parses grouped thousands with no fractional tail', () => {
    expect(parseOneNumber('1.234.567')).toBe(1234567);
  });

  it('parses grouped thousands with a 2-digit decimal tail (comma decimal)', () => {
    expect(parseOneNumber('1.234,56')).toBe(1234.56);
  });

  it('parses a plain run with a decimal tail', () => {
    expect(parseOneNumber('12,5')).toBe(12.5);
  });

  it('strips a kg suffix (case-insensitive) before parsing', () => {
    expect(parseOneNumber('1.234 KG')).toBe(1234);
    expect(parseOneNumber('1234kg')).toBe(1234);
  });

  it('parses a negative grouped value', () => {
    expect(parseOneNumber('-1.234')).toBe(-1234);
  });

  it('returns null for a non-numeric string', () => {
    expect(parseOneNumber('abc')).toBeNull();
  });

  it('returns null for the empty string', () => {
    expect(parseOneNumber('')).toBeNull();
  });

  it('returns null for a malformed group (wrong group width)', () => {
    expect(parseOneNumber('1.23.456')).toBeNull();
  });
});

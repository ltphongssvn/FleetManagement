// packages/domain/test/person-name.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDisplayName, personNameMatchKey, DriverNameSchema } from '../src/identity/person-name.js';

describe('normalizeDisplayName', () => {
  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeDisplayName('Lê  Văn   Châu')).toBe('Lê Văn Châu');
  });
  it('trims leading and trailing whitespace', () => {
    expect(normalizeDisplayName('  LÊ VĂN CHÂU  ')).toBe('LÊ VĂN CHÂU');
  });
  it('strips zero-width and NBSP characters that make identical names differ in bytes', () => {
    expect(normalizeDisplayName('Lê\u200bVăn\u00a0Châu')).toBe('LêVăn Châu');
  });
  it('NFC-composes decomposed accents so the two keying styles are byte-identical', () => {
    const decomposed = 'Le\u0302 Van Chau';
    expect(normalizeDisplayName(decomposed)).toBe(normalizeDisplayName('Lê Van Chau'));
  });
  it('PRESERVES the dispatcher case and accents (display is not folded)', () => {
    expect(normalizeDisplayName('LÊ VĂN CHÂU')).toBe('LÊ VĂN CHÂU');
    expect(normalizeDisplayName('lê văn châu')).toBe('lê văn châu');
  });
});

describe('personNameMatchKey', () => {
  it('folds case so styling variants of the same person collide', () => {
    expect(personNameMatchKey('LÊ VĂN CHÂU')).toBe(personNameMatchKey('Lê Văn Châu'));
    expect(personNameMatchKey('  lê  văn  châu ')).toBe(personNameMatchKey('LÊ VĂN CHÂU'));
  });
  it('is accent-SENSITIVE: LÊ and LE are different people', () => {
    expect(personNameMatchKey('LÊ VĂN CHÂU')).not.toBe(personNameMatchKey('LE VAN CHAU'));
  });
});

describe('DriverNameSchema', () => {
  it('parses and returns the normalized display name', () => {
    expect(DriverNameSchema.parse('  Lê   Văn  Châu ')).toBe('Lê Văn Châu');
  });
  it('rejects an empty / whitespace-only name', () => {
    expect(DriverNameSchema.safeParse('   ').success).toBe(false);
    expect(DriverNameSchema.safeParse('').success).toBe(false);
  });
  it('rejects a name that is only zero-width chars (normalizes to empty)', () => {
    expect(DriverNameSchema.safeParse('\u200b\u200c').success).toBe(false);
  });
  it('rejects a name over 200 chars', () => {
    expect(DriverNameSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

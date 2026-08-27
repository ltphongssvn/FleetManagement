// packages/domain/test/person-name.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeDisplayName,
  personNameMatchKey,
  DriverNameSchema,
} from '../src/identity/person-name.js';

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

  // RED (2026 prod defect): two ACTIVE NGUYỄN AN BÌNH ĐỨC rows coexist in
  // production. That is only possible if lower(full_name) differs in BYTES,
  // because driver_company_active_name_ci_uq is a byte-wise index. The strip
  // list covered only 4 code points while its own comment already promised
  // bidi controls too, so a name carrying one of these slipped the guard.
  //
  // Unicode names this exact class: Default_Ignorable_Code_Point (UAX #31) --
  // variation selectors, joining controls AND bidirectional ordering controls.
  // Driving the strip from the PROPERTY instead of a hand-written list is the
  // reason the list could silently fall behind its own comment.
  it('strips soft hyphen, which is invisible and splits a name in two', () => {
    expect(normalizeDisplayName('NGUYỄN\u00ad AN')).toBe('NGUYỄN AN');
  });
  it('strips the word joiner', () => {
    expect(normalizeDisplayName('NGUYỄN\u2060 AN')).toBe('NGUYỄN AN');
  });
  it('strips bidi marks LRM and RLM', () => {
    expect(normalizeDisplayName('\u200eNGUYỄN AN\u200f')).toBe('NGUYỄN AN');
  });
  it('strips Trojan-Source bidi overrides and isolates', () => {
    expect(normalizeDisplayName('\u202dNGUYỄN\u202c \u2066AN\u2069')).toBe('NGUYỄN AN');
  });

  // ORDER defect: NFC ran BEFORE the strip, so an invisible sitting between a
  // base letter and its combining mark BLOCKED canonical composition; the
  // stripped-but-uncomposed result stayed byte-different from the precomposed
  // spelling. 2026 practice is sanitize-then-normalize, not the reverse.
  it('composes accents even when an invisible separated base and combining mark', () => {
    expect(normalizeDisplayName('Le\u200b\u0302 Van Chau')).toBe('Lê Van Chau');
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

  // The prod duplicate, stated as the invariant it violated: an invisible must
  // never buy a dispatcher a second identity for the same human.
  it('collides an invisible-bearing name with its clean twin (the prod duplicate)', () => {
    expect(personNameMatchKey('NGUYỄN AN\u200e BÌNH\u00ad ĐỨC')).toBe(
      personNameMatchKey('NGUYỄN AN BÌNH ĐỨC'),
    );
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
  it('rejects a name that is only bidi controls (normalizes to empty)', () => {
    expect(DriverNameSchema.safeParse('\u202d\u2066').success).toBe(false);
  });
  it('rejects a name over 200 chars', () => {
    expect(DriverNameSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

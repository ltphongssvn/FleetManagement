// apps/api/test/name-forensics.test.ts
// RED-first spec for per-row name forensics.
//
// The roster audit proves two ACTIVE drivers fold to the same name while
// being byte-different to Postgres. It cannot say WHY, because its fold
// applies NFC normalization AND whitespace collapsing together. That
// ambiguity blocks the fix: an NFD-composed row means the DB index
// expression must normalize (lower(normalize(full_name, NFC))), whereas a
// whitespace-differing row means a writer bypassed collapseWhitespace and
// the app boundary is the leak. Guessing between them would author a repair
// before the evidence exists.
//
// This classifier attributes the difference to a specific cause per row,
// deliberately reporting each dimension independently rather than a single
// verdict -- a row can differ on more than one axis at once.
import { describe, it, expect } from 'vitest';
import { nameForensics } from '../src/admin/name-forensics.js';

describe('nameForensics', () => {
  it('reports a clean NFC single-spaced name as canonical', () => {
    const f = nameForensics('NGUYEN VAN A');
    expect(f.isNfc).toBe(true);
    expect(f.hasCollapsibleWhitespace).toBe(false);
    expect(f.hasIgnorableCodePoint).toBe(false);
    expect(f.isCanonical).toBe(true);
  });

  it('detects a decomposed (NFD) Vietnamese name', () => {
    const nfc = 'NGUY\u1ec4N AN B\u00ccNH \u0110\u1ee8C';
    const f = nameForensics(nfc.normalize('NFD'));
    expect(f.isNfc).toBe(false);
    expect(f.isCanonical).toBe(false);
    // decomposition adds combining marks, so the code-point count grows
    expect(f.codePointCount).toBeGreaterThan(nameForensics(nfc).codePointCount);
  });

  it('accepts the composed form of the same name as NFC', () => {
    const f = nameForensics('NGUY\u1ec4N AN B\u00ccNH \u0110\u1ee8C');
    expect(f.isNfc).toBe(true);
    expect(f.isCanonical).toBe(true);
  });

  it('detects a double space as collapsible whitespace', () => {
    const f = nameForensics('LE  VAN BAO');
    expect(f.hasCollapsibleWhitespace).toBe(true);
    expect(f.isNfc).toBe(true);
    expect(f.isCanonical).toBe(false);
  });

  it('detects a leading or trailing space', () => {
    expect(nameForensics(' LE VAN BAO').hasCollapsibleWhitespace).toBe(true);
    expect(nameForensics('LE VAN BAO ').hasCollapsibleWhitespace).toBe(true);
  });

  it('detects a non-breaking space, which reads as a space but is not one', () => {
    const f = nameForensics('LE\u00a0VAN BAO');
    expect(f.hasCollapsibleWhitespace).toBe(true);
    expect(f.isCanonical).toBe(false);
  });

  it('detects an invisible Default_Ignorable code point', () => {
    const f = nameForensics('LE\u200bVAN BAO');
    expect(f.hasIgnorableCodePoint).toBe(true);
    expect(f.isCanonical).toBe(false);
  });

  it('reports byte length so two visually identical names can be compared', () => {
    const nfc = 'NGUY\u1ec4N';
    expect(nameForensics(nfc.normalize('NFD')).byteLength).toBeGreaterThan(
      nameForensics(nfc).byteLength,
    );
  });

  it('is independent per dimension -- an NFD name with a double space flags both', () => {
    const f = nameForensics('NGUY\u1ec4N  VAN A'.normalize('NFD'));
    expect(f.isNfc).toBe(false);
    expect(f.hasCollapsibleWhitespace).toBe(true);
    expect(f.isCanonical).toBe(false);
  });

  it('names an ASCII-only name as carrying no diacritics', () => {
    expect(nameForensics('LE VAN BAO').hasDiacritics).toBe(false);
    expect(nameForensics('L\u00ca V\u0102N B\u1ea2O').hasDiacritics).toBe(true);
  });
});

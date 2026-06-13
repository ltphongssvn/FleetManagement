// packages/codemods/test/registry.test.ts
// RED: the registry is the single source of truth for available codemods (name +
// description + kind), powering CLI dispatch, the --list flag, and the transform-name
// enum. Fails until ../src/registry.js exists.
import { describe, it, expect } from 'vitest';
import { CODEMODS, TRANSFORM_NAMES, getCodemod, formatCodemodList } from '../src/registry.js';

describe('codemod registry', () => {
  it('registers parse-one-number with a description and kind', () => {
    const entry = getCodemod('parse-one-number');
    expect(entry?.name).toBe('parse-one-number');
    expect(entry?.kind).toBe('per-file');
    expect((entry?.description ?? '').length).toBeGreaterThan(0);
  });

  it('TRANSFORM_NAMES matches the registered codemod names', () => {
    expect([...TRANSFORM_NAMES].sort()).toEqual(CODEMODS.map((c) => c.name).sort());
  });

  it('getCodemod returns undefined for an unknown name', () => {
    expect(getCodemod('nope')).toBeUndefined();
  });

  it('formatCodemodList lists every codemod name and description', () => {
    const listing = formatCodemodList();
    for (const c of CODEMODS) {
      expect(listing).toContain(c.name);
      expect(listing).toContain(c.description);
    }
    expect(CODEMODS.length).toBeGreaterThan(0);
  });

  it('registers extract-parse-one-number as a project codemod', () => {
    const entry = getCodemod('extract-parse-one-number');
    expect(entry?.name).toBe('extract-parse-one-number');
    expect(entry?.kind).toBe('project');
    expect((entry?.description ?? '').length).toBeGreaterThan(0);
  });

  it('TRANSFORM_NAMES includes extract-parse-one-number', () => {
    expect([...TRANSFORM_NAMES]).toContain('extract-parse-one-number');
  });
});

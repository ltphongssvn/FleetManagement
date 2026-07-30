// packages/design-tokens/test/semantic.test.ts
// RED-first: drives src/semantic.ts, the SEMANTIC role layer over the base
// palette. Roles are purpose-driven (primary / danger / surface / textPrimary),
// so a consumer references intent, never a raw ramp stop -- making the wrong
// shade impossible (the 2026 semantic-token discipline). Every role must
// resolve to a hex that exists in the base palette; SemanticRoleSchema is the
// z.enum SSOT of role names (type derived via z.infer). Fails at import until
// src/semantic.ts exists.
import { describe, it, expect } from 'vitest';
import { palette, HexColorSchema } from '../src/tokens.js';
import {
  SEMANTIC_ROLES,
  SemanticRoleSchema,
  SemanticColorsSchema,
  semanticColors,
  type SemanticRole,
} from '../src/semantic.js';

const flatPalette = new Set(
  Object.values(palette).flatMap((ramp) => Object.values(ramp)),
);

describe('semantic color role layer', () => {
  it('exposes a frozen role vocabulary and a matching z.enum schema', () => {
    expect(Object.isFrozen(SEMANTIC_ROLES)).toBe(true);
    for (const role of SEMANTIC_ROLES) {
      expect(SemanticRoleSchema.safeParse(role).success).toBe(true);
    }
    expect(SemanticRoleSchema.safeParse('not_a_role').success).toBe(false);
  });

  it('parses the semantic map and defines exactly one entry per role', () => {
    const parsed = SemanticColorsSchema.parse(semanticColors);
    expect(Object.keys(parsed).sort()).toEqual([...SEMANTIC_ROLES].sort());
  });

  it('every semantic role resolves to a hex present in the base palette', () => {
    for (const role of SEMANTIC_ROLES) {
      const value = semanticColors[role];
      expect(HexColorSchema.safeParse(value).success).toBe(true);
      expect(flatPalette.has(value)).toBe(true);
    }
  });

  it('pins the core role anchors (contract stability)', () => {
    expect(semanticColors.surfaceRoot).toBe(palette.slate[950]);
    expect(semanticColors.primary).toBe(palette.indigo[600]);
    expect(semanticColors.danger).toBe(palette.red[600]);
    expect(semanticColors.success).toBe(palette.green[600]);
    expect(semanticColors.warning).toBe(palette.amber[500]);
    expect(semanticColors.textPrimary).toBe(palette.slate[900]);
  });

  it('narrows role type through the schema (no parallel union)', () => {
    const role: SemanticRole = SemanticRoleSchema.parse('primary');
    expect(role).toBe('primary');
  });
});

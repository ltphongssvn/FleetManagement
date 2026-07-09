// packages/design-tokens/test/index.test.ts
// RED-first: drives src/index.ts, the package barrel. @fleet/design-tokens is
// consumed by the ops-web Tailwind emitter and the React Native tokens emitter;
// they import from the package root, so the barrel must re-export the full
// public surface (base palette + scales + semantic layer, both schemas and
// values). Fails at import until src/index.ts re-exports everything.
import { describe, it, expect } from 'vitest';
import * as api from '../src/index.js';

describe('design-tokens package barrel', () => {
  it('re-exports the base palette schemas and values', () => {
    expect(typeof api.HexColorSchema.safeParse).toBe('function');
    expect(typeof api.PaletteSchema.parse).toBe('function');
    expect(api.palette.slate[950]).toBe('#020617');
    expect(api.spacing.xs).toBe(4);
    expect(api.radius.md).toBe(6);
    expect(api.typography.title.fontSize).toBe(20);
  });

  it('re-exports the scale schemas', () => {
    expect(typeof api.SpacingSchema.parse).toBe('function');
    expect(typeof api.RadiusSchema.parse).toBe('function');
    expect(typeof api.TypographySchema.parse).toBe('function');
    expect(typeof api.FontWeightSchema.parse).toBe('function');
  });

  it('re-exports the semantic role layer', () => {
    expect(Array.isArray(api.SEMANTIC_ROLES)).toBe(true);
    expect(typeof api.SemanticRoleSchema.parse).toBe('function');
    expect(typeof api.SemanticColorsSchema.parse).toBe('function');
    expect(api.semanticColors.primary).toBe('#4f46e5');
  });
});

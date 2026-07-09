// packages/design-tokens/src/semantic.ts
// Semantic role layer over the base palette (schema-first). Consumers reference
// PURPOSE (primary, danger, surface, textPrimary) instead of a raw ramp stop,
// so the wrong shade is structurally impossible -- the 2026 semantic-token
// discipline. SEMANTIC_ROLES is the single frozen vocabulary; the role type and
// the z.enum schema both derive from it (canonical as-const pattern). Each role
// maps to a value drawn from the base palette; the paired test asserts every
// mapping resolves to a real palette hex. Types via z.infer only -- no parallel
// hand-written unions (two-axis rule, Axis-2 SSOT).
import { z } from 'zod';
import { palette, HexColorSchema } from './tokens.js';

// The purpose-driven role vocabulary. Adding a role here forces a mapping in
// semanticColors below (the map is typed Record<SemanticRole, HexColor>), and
// the exhaustiveness test fails until the mapping exists.
export const SEMANTIC_ROLES = Object.freeze([
  'surface',
  'surfaceRoot',
  'surfaceRaised',
  'textPrimary',
  'textMuted',
  'textInverse',
  'primary',
  'primaryHover',
  'primarySubtle',
  'accent',
  'danger',
  'dangerHover',
  'dangerSubtle',
  'success',
  'warning',
  'border',
  'borderSubtle',
] as const);
export type SemanticRole = (typeof SEMANTIC_ROLES)[number];
export const SemanticRoleSchema = z.enum(SEMANTIC_ROLES);

// A semantic map is exactly one hex per role. z.record keyed by the role enum
// guarantees completeness at parse time; the type is derived via z.infer.
export const SemanticColorsSchema = z.record(SemanticRoleSchema, HexColorSchema);
export type SemanticColors = z.infer<typeof SemanticColorsSchema>;

// Role -> base palette value. Every right-hand side is a palette reference (not
// a raw literal) so the semantic layer can never drift from the ramp SSOT.
export const semanticColors = {
  surface: palette.slate[900],
  surfaceRoot: palette.slate[950],
  surfaceRaised: palette.slate[800],
  textPrimary: palette.slate[900],
  textMuted: palette.slate[500],
  textInverse: palette.base.white,
  primary: palette.indigo[600],
  primaryHover: palette.indigo[700],
  primarySubtle: palette.indigo[50],
  accent: palette.sky[50],
  danger: palette.red[600],
  dangerHover: palette.red[700],
  dangerSubtle: palette.red[50],
  success: palette.green[600],
  warning: palette.amber[500],
  border: palette.slate[200],
  borderSubtle: palette.slate[100],
} as const satisfies Record<SemanticRole, string>;

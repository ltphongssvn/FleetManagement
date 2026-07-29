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
  'surfaceSubtle',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'textFaint',
  'textInverse',
  'primary',
  'primaryHover',
  'primarySubtle',
  'primaryText',
  'primaryBorder',
  'primaryRing',
  'accent',
  'accentText',
  'danger',
  'dangerHover',
  'dangerStrong',
  'dangerText',
  'dangerSubtle',
  'dangerBorder',
  'success',
  'successStrong',
  'successText',
  'successSubtle',
  'warning',
  'warningStrong',
  'warningText',
  'warningSubtle',
  'warningBorder',
  'border',
  'borderSubtle',
  'borderStrong',
  'gradientFrom',
  'gradientVia',
  'gradientTo',
  'textOnDark',
  'textOnDarkMuted',
  'primaryOnDark',
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
  surfaceSubtle: palette.slate[50],
  textPrimary: palette.slate[900],
  textSecondary: palette.slate[700],
  textMuted: palette.slate[500],
  textFaint: palette.slate[400],
  textInverse: palette.base.white,
  primary: palette.indigo[600],
  primaryHover: palette.indigo[700],
  primarySubtle: palette.indigo[50],
  primaryText: palette.indigo[700],
  primaryBorder: palette.indigo[300],
  primaryRing: palette.indigo[500],
  accent: palette.sky[50],
  accentText: palette.sky[700],
  danger: palette.red[600],
  dangerHover: palette.red[700],
  dangerStrong: palette.red[800],
  dangerText: palette.red[700],
  dangerSubtle: palette.red[50],
  dangerBorder: palette.red[200],
  success: palette.green[600],
  successStrong: palette.green[800],
  successText: palette.green[700],
  successSubtle: palette.green[100],
  warning: palette.amber[500],
  warningStrong: palette.amber[700],
  warningText: palette.amber[900],
  warningSubtle: palette.amber[50],
  warningBorder: palette.amber[300],
  border: palette.slate[200],
  borderSubtle: palette.slate[100],
  borderStrong: palette.slate[300],
  gradientFrom: palette.indigo[950],
  gradientVia: palette.violet[500],
  gradientTo: palette.violet[950],
  textOnDark: palette.base.white,
  textOnDarkMuted: palette.slate[300],
  primaryOnDark: palette.indigo[300],
} as const satisfies Record<SemanticRole, string>;

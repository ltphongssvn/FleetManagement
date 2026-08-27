// packages/design-tokens/src/index.ts
// Public barrel for @fleet/design-tokens. The ops-web Tailwind emitter and the
// React Native tokens emitter import the token SSOT from the package root; this
// file re-exports the full surface (base palette + scales, and the semantic
// role layer -- schemas, values, and z.infer types). Pure re-exports only;
// excluded from coverage (see vitest.config.ts).
// Enumerated rather than starred. "Re-exports the full surface" was true of the
// wildcard and is still true here -- the difference is that this list IS the
// surface, so adding an internal helper to tokens.ts no longer publishes it by
// accident, and a reader learns the package API without opening two modules.
export {
  HexColorSchema,
  type HexColor,
  PaletteSchema,
  type Palette,
  palette,
  SpacingSchema,
  type Spacing,
  spacing,
  RadiusSchema,
  type Radius,
  radius,
  FONT_WEIGHTS,
  type FontWeight,
  FontWeightSchema,
  TypographySchema,
  type Typography,
  typography,
  FontSizeSchema,
  type FontSize,
  fontSize,
  ShadowSchema,
  type Shadow,
  shadow,
} from './tokens.js';
export {
  SEMANTIC_ROLES,
  type SemanticRole,
  SemanticRoleSchema,
  SemanticColorsSchema,
  type SemanticColors,
  semanticColors,
} from './semantic.js';

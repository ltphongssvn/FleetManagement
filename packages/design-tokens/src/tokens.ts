// packages/design-tokens/src/tokens.ts
// Base design-token SSOT (schema-first, Zod-validated). This is the single
// definition of the FleetManagement visual language: color ramps, the 4px
// spacing rhythm, radius and type scales. Before this module the same values
// were duplicated as ops-web implicit Tailwind defaults AND hand-written in
// apps/driver-app/src/theme/tokens.ts. Every surface now derives from here:
// ops-web via a Tailwind v4 @theme emitter (CSS variables), the React Native
// apps via a generated theme/tokens.ts. Types are DERIVED from the schemas via
// z.infer -- never hand-written in parallel (two-axis rule, Axis-2 SSOT).
// These are trusted build-time constants: validation happens at EMIT time when
// generating platform outputs, NOT at app runtime (Axis-1: no trust boundary
// is crossed by our own typed constants).
import { z } from 'zod';

// A canonical color token: lowercase 6-digit hex. Lowercase is enforced so the
// emitted CSS variables and RN constants are byte-identical across surfaces.
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'expected lowercase 6-digit hex, e.g. #020617');
export type HexColor = z.infer<typeof HexColorSchema>;

// A ramp is a set of numbered stops (Tailwind-style) mapping to hex values.
const RampSchema = z.record(z.string(), HexColorSchema);

// The full palette: named ramps plus a small base group (white/black anchors).
export const PaletteSchema = z.object({
  slate: RampSchema,
  indigo: RampSchema,
  sky: RampSchema,
  violet: RampSchema,
  red: RampSchema,
  green: RampSchema,
  amber: RampSchema,
  base: RampSchema,
});
export type Palette = z.infer<typeof PaletteSchema>;

// Exact current brand values (faithful lift from the Tailwind defaults that
// ops-web renders + apps/driver-app/src/theme/tokens.ts). No redesign here.
export const palette = {
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  indigo: {
    50: '#eef2ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    900: '#312e81',
    950: '#1e1b4b',
  },
  sky: {
    50: '#f0f9ff',
    600: '#0284c7',
    700: '#0369a1',
  },
  violet: {
    500: '#8b5cf6',
    950: '#2e1065',
  },
  red: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
  },
  green: {
    100: '#d1fae5',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
  },
  amber: {
    50: '#fffbeb',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    900: '#78350f',
  },
  base: { white: '#ffffff', black: '#000000' },
} as const;

// 4px spacing rhythm (matches Tailwind spacing). Strictly ascending.
export const SpacingSchema = z.object({
  xs: z.number().int().positive(),
  sm: z.number().int().positive(),
  md: z.number().int().positive(),
  lg: z.number().int().positive(),
  xl: z.number().int().positive(),
  xxl: z.number().int().positive(),
});
export type Spacing = z.infer<typeof SpacingSchema>;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Border radii (Tailwind rounded-md / rounded-xl / rounded-2xl).
export const RadiusSchema = z.object({
  md: z.number().int().positive(),
  lg: z.number().int().positive(),
  xl: z.number().int().positive(),
});
export type Radius = z.infer<typeof RadiusSchema>;
export const radius = { md: 6, lg: 12, xl: 16 } as const;

// Type scale. Font weights are the frozen set the design uses; schema + type
// both derive from it (canonical as-const pattern).
export const FONT_WEIGHTS = Object.freeze(['400', '600', '700'] as const);
export type FontWeight = (typeof FONT_WEIGHTS)[number];
export const FontWeightSchema = z.enum(FONT_WEIGHTS);

const TypeScaleSchema = z.object({
  fontSize: z.number().positive(),
  fontWeight: FontWeightSchema,
  letterSpacing: z.number().optional(),
});
export const TypographySchema = z.object({
  title: TypeScaleSchema,
  heading: TypeScaleSchema,
  body: TypeScaleSchema,
  label: TypeScaleSchema,
  caption: TypeScaleSchema,
});
export type Typography = z.infer<typeof TypographySchema>;
export const typography = {
  title: { fontSize: 20, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

// Numeric font-size scale (React Native reads raw sizes directly, e.g. a hero
// number or button label). Canonical superset covering the app display sizes;
// the composite typography styles above pair sizes with weights, this is the
// bare scale for RN inline text styles. Strictly ascending.
export const FontSizeSchema = z.object({
  sm: z.number().positive(),
  base: z.number().positive(),
  lg: z.number().positive(),
  xl: z.number().positive(),
  xxl: z.number().positive(),
  huge: z.number().positive(),
});
export type FontSize = z.infer<typeof FontSizeSchema>;
export const fontSize = { sm: 13, base: 15, lg: 18, xl: 24, xxl: 34, huge: 56 } as const;

// Elevation primitive for React Native raised surfaces. shadowColor references
// the palette so it cannot drift from the ramp; offset/opacity/radius/elevation
// are the RN Platform shadow fields. One canonical card elevation shared by
// every raised RN surface.
export const ShadowSchema = z.object({
  card: z.object({
    shadowColor: HexColorSchema,
    shadowOffset: z.object({ width: z.number(), height: z.number() }),
    shadowOpacity: z.number().min(0).max(1),
    shadowRadius: z.number().nonnegative(),
    elevation: z.number().nonnegative(),
  }),
});
export type Shadow = z.infer<typeof ShadowSchema>;
export const shadow = {
  card: {
    shadowColor: palette.slate[900],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

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
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    950: '#1e1b4b',
  },
  sky: { 50: '#f0f9ff' },
  violet: { 950: '#2e1065' },
  red: { 50: '#fef2f2', 200: '#fecaca', 600: '#dc2626', 700: '#b91c1c' },
  green: { 600: '#059669' },
  amber: { 500: '#f59e0b' },
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

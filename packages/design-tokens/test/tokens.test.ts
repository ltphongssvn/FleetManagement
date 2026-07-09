// packages/design-tokens/test/tokens.test.ts
// RED-first (schema-first token SSOT). Drives src/tokens.ts: the base design
// tokens (color ramps, spacing, radius, type scale) that today live duplicated
// as ops-web's implicit Tailwind defaults AND driver-app/src/theme/tokens.ts.
// One Zod-validated SSOT here; every surface derives from it. Values pinned to
// the CURRENT palette so this is a faithful lift (no visual redesign) before
// the semantic layer + emitters land. Fails at import until src/tokens.ts exists.
import { describe, it, expect } from 'vitest';
import {
  HexColorSchema,
  PaletteSchema,
  palette,
  spacing,
  radius,
  typography,
  SpacingSchema,
  RadiusSchema,
  TypographySchema,
} from '../src/tokens.js';

describe('design-tokens base palette', () => {
  it('accepts canonical lowercase 6-digit hex and rejects malformed values', () => {
    expect(HexColorSchema.safeParse('#020617').success).toBe(true);
    expect(HexColorSchema.safeParse('#FFFFFF').success).toBe(false);
    expect(HexColorSchema.safeParse('#fff').success).toBe(false);
    expect(HexColorSchema.safeParse('020617').success).toBe(false);
    expect(HexColorSchema.safeParse('#12345g').success).toBe(false);
  });

  it('parses the full palette and every ramp value is a valid hex', () => {
    const parsed = PaletteSchema.parse(palette);
    const flat = Object.values(parsed).flatMap((ramp) => Object.values(ramp));
    expect(flat.length).toBeGreaterThan(0);
    for (const v of flat) expect(HexColorSchema.safeParse(v).success).toBe(true);
  });

  it('preserves the exact current brand values (faithful lift, no redesign)', () => {
    expect(palette.slate[950]).toBe('#020617');
    expect(palette.slate[900]).toBe('#0f172a');
    expect(palette.indigo[600]).toBe('#4f46e5');
    expect(palette.indigo[700]).toBe('#4338ca');
    expect(palette.red[600]).toBe('#dc2626');
    expect(palette.green[600]).toBe('#059669');
    expect(palette.amber[500]).toBe('#f59e0b');
    expect(palette.base.white).toBe('#ffffff');
  });

  it('spacing follows the 4px rhythm and is strictly ascending', () => {
    expect(SpacingSchema.parse(spacing)).toEqual(spacing);
    const vals = [spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl, spacing.xxl];
    expect(vals).toEqual([4, 8, 12, 16, 24, 32]);
    vals.reduce((prev, cur) => {
      expect(cur).toBeGreaterThan(prev);
      return cur;
    });
  });

  it('radius scale is strictly ascending with the current values', () => {
    expect(RadiusSchema.parse(radius)).toEqual(radius);
    const vals = [radius.md, radius.lg, radius.xl];
    expect(vals).toEqual([6, 12, 16]);
    vals.reduce((prev, cur) => {
      expect(cur).toBeGreaterThan(prev);
      return cur;
    });
  });

  it('type scale carries fontSize + fontWeight, label keeps its letter-spacing', () => {
    expect(TypographySchema.parse(typography)).toEqual(typography);
    expect(typography.title.fontSize).toBe(20);
    expect(typography.title.fontWeight).toBe('700');
    expect(typography.label.letterSpacing).toBe(0.6);
    for (const scale of Object.values(typography)) {
      expect(scale.fontSize).toBeGreaterThan(0);
      expect(['400', '600', '700']).toContain(scale.fontWeight);
    }
  });
});

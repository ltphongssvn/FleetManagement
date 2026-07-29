// packages/design-tokens/test/react-native.test.ts
// RED-first: drives src/react-native.ts, the React Native adapter. RN UI reads
// a FLAT token shape (colors.slate900, colors.indigo600, colors.backdrop,
// colors.white, spacing.md, radius.lg, typography.title, fontSize.xxl,
// shadow.card) -- unlike ops-web which consumes CSS variables. This adapter
// presents that flat shape derived from the canonical SSOT primitives, so both
// RN apps re-export it and can never drift. colors flattens the palette ramps
// (slateNNN / indigoNNN / ...) and adds the backdrop + white aliases the
// screens use. Fails until src/react-native.ts exists.
import { describe, it, expect } from 'vitest';
import { colors, spacing, radius, typography, fontSize, shadow } from '../src/react-native.js';
import { palette, HexColorSchema } from '../src/tokens.js';

describe('react native token adapter', () => {
  it('flattens the palette ramps into colorRampStop keys', () => {
    expect(colors.slate900).toBe(palette.slate[900]);
    expect(colors.slate950).toBe(palette.slate[950]);
    expect(colors.indigo600).toBe(palette.indigo[600]);
    expect(colors.indigo700).toBe(palette.indigo[700]);
    expect(colors.red200).toBe(palette.red[200]);
    expect(colors.green600).toBe(palette.green[600]);
  });

  it('exposes the backdrop and white aliases the RN screens use', () => {
    expect(colors.backdrop).toBe(palette.slate[950]);
    expect(colors.white).toBe(palette.base.white);
  });

  it('every flattened color is a valid palette hex', () => {
    for (const v of Object.values(colors)) {
      expect(HexColorSchema.safeParse(v).success).toBe(true);
    }
  });

  it('passes through the scale primitives unchanged', () => {
    expect(spacing.md).toBe(12);
    expect(radius.lg).toBe(12);
    expect(fontSize.xxl).toBe(34);
    expect(typography.title.fontSize).toBe(20);
    expect(shadow.card.shadowOffset).toEqual({ width: 0, height: 2 });
  });

  it('covers every color key both RN apps import today', () => {
    const required = [
      'white', 'backdrop', 'slate300', 'slate400', 'slate500', 'slate600',
      'slate900', 'slate950', 'indigo500', 'indigo600', 'indigo700', 'red200',
    ];
    for (const key of required) {
      expect(Object.prototype.hasOwnProperty.call(colors, key)).toBe(true);
    }
  });
});

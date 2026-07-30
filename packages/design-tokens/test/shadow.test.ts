// packages/design-tokens/test/shadow.test.ts
// RED-first: drives the canonical shadow primitive on the token SSOT. React
// Native elevation is expressed as a shadow object (color, offset, opacity,
// radius, elevation); driver-app uses shadow.card on raised surfaces. One
// canonical definition here, consumed via the RN adapter, so every raised RN
// surface shares one elevation. shadowColor references the palette (slate900)
// so it cannot drift from the ramp. Fails until tokens.ts exports shadow +
// ShadowSchema.
import { describe, it, expect } from 'vitest';
import { shadow, ShadowSchema, palette, HexColorSchema } from '../src/tokens.js';

describe('shadow primitive', () => {
  it('parses the shadow map and exposes a card elevation', () => {
    expect(ShadowSchema.parse(shadow)).toEqual(shadow);
    expect(shadow.card).toBeDefined();
  });

  it('card carries the RN elevation fields with sane values', () => {
    const c = shadow.card;
    expect(HexColorSchema.safeParse(c.shadowColor).success).toBe(true);
    expect(c.shadowColor).toBe(palette.slate[900]);
    expect(c.shadowOffset).toEqual({ width: 0, height: 2 });
    expect(c.shadowOpacity).toBeGreaterThan(0);
    expect(c.shadowOpacity).toBeLessThanOrEqual(1);
    expect(c.shadowRadius).toBeGreaterThan(0);
    expect(c.elevation).toBeGreaterThanOrEqual(0);
  });
});

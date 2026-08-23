// packages/design-tokens/test/fontsize.test.ts
// RED-first: drives a canonical numeric fontSize scale on the token SSOT. The
// React Native apps consume raw font sizes directly (owner-app: fontSize.xxl
// for the hero, fontSize.base for body, fontSize.lg for buttons). This is the
// platform-agnostic primitive scale they read through the RN adapter, so every
// RN text size resolves from one source. Values are the canonical superset
// (includes the larger display sizes the dashboard needs). Fails until
// tokens.ts exports fontSize + FontSizeSchema.
import { describe, it, expect } from 'vitest';
import { fontSize, FontSizeSchema } from '../src/tokens.js';

describe('fontSize primitive scale', () => {
  it('parses the scale and pins the canonical values', () => {
    expect(FontSizeSchema.parse(fontSize)).toEqual(fontSize);
    expect(fontSize.sm).toBe(13);
    expect(fontSize.base).toBe(15);
    expect(fontSize.lg).toBe(18);
    expect(fontSize.xl).toBe(24);
    expect(fontSize.xxl).toBe(34);
    expect(fontSize.huge).toBe(56);
  });

  it('is strictly ascending (a real scale)', () => {
    const vals = [
      fontSize.sm,
      fontSize.base,
      fontSize.lg,
      fontSize.xl,
      fontSize.xxl,
      fontSize.huge,
    ];
    vals.reduce((prev, cur) => {
      expect(cur).toBeGreaterThan(prev);
      return cur;
    });
  });

  it('every size is a positive number', () => {
    for (const v of Object.values(fontSize)) expect(v).toBeGreaterThan(0);
  });
});

// packages/design-tokens/test/emit-ops-web.test.ts
// RED-first: drives src/emit-ops-web.ts, the ops-web Tailwind v4 emitter. It
// transforms the token SSOT into the @theme block for apps/ops-web globals.css
// so ops-web utilities (bg-slate-950, bg-primary, ...) resolve from the SSOT
// instead of Tailwind implicit defaults. Pure function returning a CSS string
// (the file write is a separate I/O step). Base ramps emit as
// --color-<ramp>-<stop>; the base group emits as --color-white / --color-black
// with no base- prefix; semantic roles emit kebab-cased. Fails at import until
// src/emit-ops-web.ts exists.
import { describe, it, expect } from 'vitest';
import { emitOpsWebThemeCss } from '../src/emit-ops-web.js';
import { palette, semanticColors, SEMANTIC_ROLES } from '../src/index.js';

const kebab = (s: string): string =>
  s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

describe('ops-web Tailwind v4 @theme emitter', () => {
  const css = emitOpsWebThemeCss();

  it('opens with the path banner, auto-gen notice, tailwind import', () => {
    expect(css.startsWith('/* apps/ops-web/src/app/globals.css */')).toBe(true);
    expect(css.includes('AUTO-GENERATED')).toBe(true);
    expect(css.includes('@fleet/design-tokens')).toBe(true);
    expect(css.includes('@import ' + String.fromCharCode(34) + 'tailwindcss' + String.fromCharCode(34) + ';')).toBe(true);
  });

  it('wraps tokens in a single @theme block', () => {
    expect(css.includes('@theme {')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('emits every base ramp stop as --color-<ramp>-<stop>', () => {
    for (const [ramp, stops] of Object.entries(palette)) {
      if (ramp === 'base') continue;
      for (const [stop, hex] of Object.entries(stops)) {
        expect(css.includes('--color-' + ramp + '-' + stop + ': ' + hex + ';')).toBe(true);
      }
    }
  });

  it('emits the base group with no base- prefix', () => {
    expect(css.includes('--color-white: #ffffff;')).toBe(true);
    expect(css.includes('--color-black: #000000;')).toBe(true);
    expect(css.includes('--color-base-')).toBe(false);
  });

  it('emits every semantic role kebab-cased with its resolved hex', () => {
    expect(css.includes('--color-surface-root: #020617;')).toBe(true);
    expect(css.includes('--color-primary: #4f46e5;')).toBe(true);
    expect(css.includes('--color-primary-hover: #4338ca;')).toBe(true);
    expect(css.includes('--color-danger: #dc2626;')).toBe(true);
    expect(css.includes('--color-text-primary: #0f172a;')).toBe(true);
    for (const role of SEMANTIC_ROLES) {
      expect(css.includes('--color-' + kebab(role) + ': ' + semanticColors[role] + ';')).toBe(true);
    }
  });

  it('is deterministic across calls', () => {
    expect(emitOpsWebThemeCss()).toBe(css);
  });
});

// packages/design-tokens/src/emit-ops-web.ts
// ops-web Tailwind v4 emitter (pure). Transforms the token SSOT into the
// @theme block written to apps/ops-web/src/app/globals.css, so ops-web
// utilities resolve from @fleet/design-tokens instead of Tailwind implicit
// defaults -- making the SSOT authoritative and drift-guardable. Base ramps
// become --color-<ramp>-<stop>; the base group becomes --color-white /
// --color-black (no base- prefix); semantic roles become kebab-cased custom
// colors (bg-primary, bg-surface-root, ...). This function only builds a
// string; writing the file is a separate I/O step (Turbo tokens:build).
// Sibling modules directly. Importing the barrel from inside the package is a
// cycle by construction: index.js re-exports this very file.
import { palette } from './tokens.js';
import { semanticColors, SEMANTIC_ROLES } from './semantic.js';

const BANNER = [
  '/* apps/ops-web/src/app/globals.css */',
  '/* AUTO-GENERATED from @fleet/design-tokens -- do not edit by hand. */',
  '/* Regenerate via: pnpm exec turbo run tokens:build. */',
].join('\n');

// camelCase -> kebab-case without a regex (keeps char handling explicit).
function kebab(name: string): string {
  let out = '';
  for (const ch of name) {
    const lower = ch.toLowerCase();
    out += ch !== lower ? '-' + lower : ch;
  }
  return out;
}

export function emitOpsWebThemeCss(): string {
  const lines: string[] = [];
  lines.push('  /* base ramps */');
  for (const [ramp, stops] of Object.entries(palette)) {
    if (ramp === 'base') continue;
    for (const [stop, hex] of Object.entries(stops as Record<string, string>)) {
      lines.push('  --color-' + ramp + '-' + stop + ': ' + hex + ';');
    }
  }
  lines.push('');
  lines.push('  /* base anchors */');
  for (const [name, hex] of Object.entries(palette.base as Record<string, string>)) {
    lines.push('  --color-' + name + ': ' + hex + ';');
  }
  lines.push('');
  lines.push('  /* semantic roles (purpose-driven; the only shade a consumer should name) */');
  for (const role of SEMANTIC_ROLES) {
    lines.push('  --color-' + kebab(role) + ': ' + semanticColors[role] + ';');
  }
  const theme = '@theme {\n' + lines.join('\n') + '\n}';
  return (
    BANNER +
    '\n\n@import ' +
    String.fromCharCode(34) +
    'tailwindcss' +
    String.fromCharCode(34) +
    ';\n\n' +
    theme +
    '\n'
  );
}

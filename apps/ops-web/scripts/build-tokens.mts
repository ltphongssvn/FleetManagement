// apps/ops-web/scripts/build-tokens.mts
// ops-web design-token codegen. Imports the pure emitter from
// @fleet/design-tokens by package name (ops-web declares it as a workspace
// dependency) and writes ops-web OWN src/app/globals.css -- no cross-package
// filesystem reach (2026 Turborepo boundary rule). Runs on plain Node via the
// .mts extension (always ESM; Node 24 strips types) so there is no tsx
// phantom-dependency. Two modes, driven by the ops-web Turbo tasks:
//   tokens:build -> regenerate globals.css from the token SSOT
//   tokens:check -> regenerate in-memory and exit 1 on drift (CI guard)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { emitOpsWebThemeCss } from '@fleet/design-tokens/emit-ops-web';

const here = dirname(fileURLToPath(import.meta.url));
const GLOBALS_CSS = resolve(here, '..', 'src', 'app', 'globals.css');

const mode = process.argv[2];
const css = emitOpsWebThemeCss();

if (mode === 'write') {
  writeFileSync(GLOBALS_CSS, css);
  console.error('[tokens] wrote ' + GLOBALS_CSS);
} else if (mode === 'check') {
  const current = existsSync(GLOBALS_CSS) ? readFileSync(GLOBALS_CSS, 'utf8') : '';
  if (current !== css) {
    console.error('[tokens] DRIFT: src/app/globals.css is out of sync with @fleet/design-tokens.');
    console.error('[tokens] Run: pnpm exec turbo run tokens:build --filter=@fleet/ops-web');
    process.exit(1);
  }
  console.error('[tokens] globals.css in sync with the token SSOT.');
} else {
  console.error('[tokens] usage: build-tokens.mts <write|check>');
  process.exit(2);
}

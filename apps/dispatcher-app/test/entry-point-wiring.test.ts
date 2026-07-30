// apps/dispatcher-app/test/entry-point-wiring.test.ts
// S6-spine (T17 voice-dispatch) -- outside-in strict TDD, structural guard.
//
// ROOT CAUSE (Expo Router docs, custom entry point section, and expo/expo
// discussion 25122 answered by the Expo Router author): app/_layout.tsx is a
// ROUTE MODULE, not the root of the module graph. Expo Router decides when it
// evaluates, and a nested group layout can evaluate BEFORE it -- reported in
// that thread by a developer whose polyfill in app/_layout.tsx loaded after
// (tabs)/_layout.tsx. So making the polyfill the first import of the root
// layout is an invariant the framework never promised: it holds by accident
// of the current route tree and breaks silently the day a route group is
// added. A test pinning THAT would freeze the accident and stay green while
// the device broke.
//
// The documented fix is a custom entry point: a file at the package root
// whose first import is the side effect and whose LAST import is the router
// registration, with package.json main repointed at it. That file IS the
// module graph root, so ordering is enforced by the module system rather than
// by convention. This guard pins the entry, not the layout.
//
// SOURCE-CONTRACT guard, same trade as the driver-app notification boot wiring
// test: the entry and the router shell mount native modules and sit outside
// the coverage include set, so the guard asserts what the source MUST say.
// Import ORDER is a property of the text, not of behaviour -- by the time any
// module could be observed at runtime, a module evaluated ahead of the
// polyfill has already captured the broken whatwg-fetch reference.
//
// EVERY structural assertion below runs on COMMENT-STRIPPED source. The first
// draft of this guard did not, and it failed against a CORRECT entry file:
// the comment explaining why the router import must come last mentions that
// specifier dozens of lines above the imports, so a raw indexOf compared a
// comment against code and reported the order backwards. A guard that fails
// on correct code is worse than no guard -- it sends the next reader to
// repair something that was never broken.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);
const read = (rel: string): string =>
  readFileSync(resolve(here, '..', rel), 'utf8');
// Repo style is line comments only; a block-comment stripper would be dead
// code here and is deliberately omitted.
const stripComments = (s: string): string =>
  s
    .split(NL)
    .filter((l) => !l.trimStart().startsWith('//'))
    .join(NL);
const code = (rel: string): string => stripComments(read(rel));
const ENTRY = 'index.js';
const LAYOUT = 'app/_layout.tsx';
const POLYFILL = 'install-fetch-polyfill';
const ROUTER_ENTRY = 'expo-router/entry';
interface PackageManifest {
  main?: string;
}
const importLines = (s: string): string[] =>
  s.split(NL).filter((l) => l.trimStart().startsWith('import '));
describe('@fleet/dispatcher-app - entry point wiring (T17 S6)', () => {
  it('repoints package.json main at the custom entry, not the router entry', () => {
    const pkg = JSON.parse(read('package.json')) as PackageManifest;
    expect(
      pkg.main,
      'main must load the custom entry first; pointing straight at the router entry leaves no place for a side effect to run before route modules',
    ).toBe(ENTRY);
  });
  it('makes the fetch polyfill the VERY FIRST import of the entry', () => {
    const lines = importLines(code(ENTRY));
    expect(lines.length, 'the entry must contain imports').toBeGreaterThan(0);
    expect(
      lines[0]?.includes(POLYFILL),
      'anything evaluated before the polyfill captures the broken whatwg-fetch reference for the life of the process',
    ).toBe(true);
  });
  it('imports the polyfill for side effect only, with no bindings', () => {
    const lines = importLines(code(ENTRY));
    expect(
      lines[0]?.includes(' from '),
      'the polyfill installs a global on evaluation and exports nothing; a named import would misrepresent that',
    ).toBe(false);
  });
  it('registers the router from the entry', () => {
    expect(
      code(ENTRY).includes(ROUTER_ENTRY),
      'without this import the app has no registered root component and never renders',
    ).toBe(true);
  });
  it('registers the router LAST, after every side effect', () => {
    const lines = importLines(code(ENTRY));
    expect(
      lines[lines.length - 1]?.includes(ROUTER_ENTRY),
      'the router entry pulls in the whole route tree and the RN networking stack, so every side effect must already have run',
    ).toBe(true);
  });
  it('evaluates the polyfill BEFORE the router entry (comment-stripped)', () => {
    const s = code(ENTRY);
    const polyIdx = s.indexOf(POLYFILL);
    const routerIdx = s.indexOf(ROUTER_ENTRY);
    expect(polyIdx, 'the polyfill import must be present in code').toBeGreaterThan(-1);
    expect(routerIdx, 'the router import must be present in code').toBeGreaterThan(-1);
    expect(
      polyIdx,
      'ordering is compared on code only; prose about the router in a header comment is not an import',
    ).toBeLessThan(routerIdx);
  });
  it('installs the polyfill in exactly ONE place (single source of truth)', () => {
    expect(
      code(ENTRY).includes(POLYFILL),
      'the entry is the only correct place',
    ).toBe(true);
    expect(
      code(LAYOUT).includes(POLYFILL),
      'a second import in the root layout would resurrect the ordering convention this slice replaced, and imply the entry cannot be trusted',
    ).toBe(false);
  });
  it('exports a default root layout that renders the router outlet', () => {
    const s = code(LAYOUT);
    expect(
      s.includes('export default function'),
      'expo-router requires a default export from the root layout',
    ).toBe(true);
    expect(
      s.includes('Slot') && s.includes('expo-router'),
      'without a Slot outlet the router never renders the index route',
    ).toBe(true);
  });
  it('keeps the entry and router shell outside the coverage include set', () => {
    const cfg = read('vitest.config.ts');
    expect(
      cfg.includes('src/**/*.ts') && !cfg.includes('app/**'),
      'the entry and app/ shell mount native modules and are not unit-runnable; coverage stays scoped to src',
    ).toBe(true);
  });
});

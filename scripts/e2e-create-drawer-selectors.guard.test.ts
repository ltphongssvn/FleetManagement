// scripts/e2e-create-drawer-selectors.guard.test.ts
// Guard: the dispatch board keeps a stable readiness + selector contract, and the
// create drawer never regresses to a hand-rolled overlay.
//
// T38 (cf887ab) made the board table-first and turned the whole E2E gate red,
// blocking promote -> Railway for every terminal. Three separate source-level
// causes, one guard case each, all fast (no browser, runs in the PR gate):
//
//   1. READINESS WAS BOUND TO A COMPONENT. data-hydrated existed only on the
//      create form, so specs used form-is-hydrated as a proxy for
//      board-is-interactive. Once the form moved behind the drawer that proxy
//      forced board-only specs to OPEN a drawer they did not need. Readiness is a
//      property of the PAGE, so the board root now carries its own signal.
//
//   2. THE QUERYABLE SURFACE NARROWED SILENTLY. The re-layout kept the FormData
//      names but dropped every id, breaking 54 spec selectors that had nothing to
//      do with presentation. The ids are restored and pinned here.
//
//   3. THE DRAWER WAS HAND-ROLLED. A full-viewport button styled
//      absolute inset-0 served as the backdrop and intercepted every pointer
//      event on the board beneath it. Headless UI Dialog replaces it (native
//      dialog + showModal is the generic 2026 answer but would paint over the
//      Floating UI portal that ComboboxField anchors its listbox into).
//
// PARSING (2026-08-23). Three cases below asserted markup with string
// containment against a hard-coded quote character built from
// String.fromCharCode(39) -- data-testid='dispatch-board', id='cargo',
// role='status'. Quote style is PRESENTATION and Prettier owns it: this repo
// commits singleQuote:true, which governs JS string literals, while JSX
// attributes keep double quotes (jsxSingleQuote, default false). Formatting the
// tree flipped every JSX attribute and all three failed at once with the
// contract completely intact -- 7 of 7 field ids still present, still queryable.
//
// "This element carries this attribute with this value" is a STRUCTURAL claim,
// so jsx-attributes.ts answers it from the AST. That also makes the guard
// stronger than it was: id={'cargo'} and id="cargo" are the same contract to a
// parser and different strings to a search, so the old version would have
// reported a false regression on a purely syntactic edit.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { hasJsxAttribute, jsxAttributes, liveRegionIsStatic } from './source-facts.js';

const ROOT = join(import.meta.dirname, '..');
const E2E_DIR = join(ROOT, 'e2e');
const DISPATCH_DIR = join(ROOT, 'apps', 'ops-web', 'src', 'features', 'dispatch');
const NL_FORM = join(DISPATCH_DIR, 'NaturalLanguageCreateForm.tsx');
const VIEW = join(DISPATCH_DIR, 'DispatchView.tsx');

// Retired by T38. The negative lookbehind keeps nl-create-order-form clean.
const RETIRED_TESTID = /(?<!nl-)create-order-form/;
const RETIRED_ID = /#plannedStartAt/;
// Reaching the create form by CSS tag + text filter. This shape slipped past
// the first two patterns during the T38 repair and cost a full 15-minute suite
// run to surface, because locator(form).filter({hasText}) names no stable
// contract at all -- it matches whatever markup happens to contain the text.
const CSS_FORM_LOCATOR = /locator\\('form'\\)/;

// Every field id the e2e suite queries, unchanged since before T38.
const REQUIRED_IDS = [
  'plannedStartAt',
  'pickupAt',
  'deliveryAt',
  'cargo',
  'customer',
  'vehiclePlate',
  'assignedOperatorId',
];

function specFiles(): readonly string[] {
  return readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => join(E2E_DIR, f));
}

function offendersMatching(re: RegExp): readonly string[] {
  const out: string[] = [];
  for (const file of specFiles()) {
    const lines = readFileSync(file, 'utf-8').split(String.fromCharCode(10));
    lines.forEach((line, i) => {
      if (re.test(line)) out.push(basename(file) + ':' + String(i + 1));
    });
  }
  return out;
}

describe('dispatch board readiness and selector contract', () => {
  it('no spec references the retired create-order-form testid', () => {
    expect(offendersMatching(RETIRED_TESTID)).toEqual([]);
  });

  it('no spec reaches the date field by the retired id selector', () => {
    expect(offendersMatching(RETIRED_ID)).toEqual([]);
  });

  it('no spec reaches the create form by a CSS tag plus text filter', () => {
    expect(offendersMatching(CSS_FORM_LOCATOR)).toEqual([]);
  });

  it('the board root carries its own hydration-readiness signal', () => {
    expect(hasJsxAttribute(VIEW, 'data-testid', 'dispatch-board')).toBe(true);
    expect(jsxAttributes(VIEW).has('data-hydrated')).toBe(true);
  });

  it('the drawer form still exposes every queried field id', () => {
    const ids = jsxAttributes(NL_FORM).get('id') ?? new Set<string | null>();
    // Vacuity guard: an empty id set would make the filter below trivially
    // empty, which reads exactly like every id being present.
    expect(ids.size).toBeGreaterThan(0);
    const missing = REQUIRED_IDS.filter((f) => !ids.has(f));
    expect(missing).toEqual([]);
  });

  it('the success banner is a persistent live region on the board', () => {
    // The board owns it, so it survives the drawer closing on success.
    expect(hasJsxAttribute(VIEW, 'role', 'status')).toBe(true);
    expect(hasJsxAttribute(NL_FORM, 'role', 'status')).toBe(false);
    // WCAG 4.1.3: the CONTAINER must exist from first paint; only its content
    // may be conditional, because assistive technology never begins monitoring
    // a region that did not exist at load.
    //
    // Asserted STRUCTURALLY. The previous version pinned two exact source
    // strings -- '{createdRef !== null ? (' and '{createdRef === null ? null :
    // ('  -- which encode Prettier's line-breaking of a ternary, not the
    // accessibility contract. A rewrap would have failed the guard while the
    // markup was correct, and an equivalent rewrite (an && guard, say) would
    // have passed while silently breaking WCAG. What actually matters is that
    // the role=status element is NOT inside a conditional: liveRegionIsStatic
    // walks up from the attribute to the enclosing JSX and reports whether any
    // ancestor is a conditional expression.
    expect(liveRegionIsStatic(VIEW)).toBe(true);
  });

  it('the drawer uses Headless UI Dialog, not a hand-rolled overlay', () => {
    const src = readFileSync(VIEW, 'utf-8');
    expect(src).toContain('@headlessui/react');
    expect(src).toContain('<DialogPanel');
    // A full-viewport absolutely-positioned backdrop is the exact shape that
    // intercepted board clicks; the library owns the backdrop now.
    expect(src).not.toContain('absolute inset-0 bg-slate-900');
  });
});

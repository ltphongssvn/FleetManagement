// scripts/estate-layering.guard.test.ts
// GUARD: the domain must stay unaware of presentation.
//
// Fowler's Separated Presentation gives the test, and it is about DIRECTION,
// not files: "keep presentation code and domain code in separate layers with
// the domain code unaware of presentation code". He is equally explicit that
// "the layers are a logical and not a physical construct ... physical
// separation is not required (and a bad idea if not necessary)", so splitting
// estate-verify.ts in two would be cosmetic.
//
// The direction currently holds, but only by convention -- nothing stops a
// future edit from having classifyEstate embed a formatted message, at which
// point the verdict carries prose and every consumer inherits an English
// dependency. This asserts it structurally, reading the AST rather than the
// text, so a mention inside a COMMENT cannot trip it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const DOMAIN = 'scripts/estate-verify.ts';

/** Identifiers referenced inside one function's body. */
function identifiersIn(path: string, fnName: string): ReadonlySet<string> {
  const sf = ts.createSourceFile(
    path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName && node.body) {
      collect(node.body);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return names;
}

describe('estate layering: domain is unaware of presentation', () => {
  // The renderings. Either may depend on the domain; neither may be depended on.
  const PRESENTATION = ['describeEstate', 'estateTelemetry', 'unreadableEstateTelemetry'];

  for (const fn of ['classifyEstate', 'reasonsFor', 'kindsFor', 'estateDigest']) {
    it(`${fn} references no presentation function`, () => {
      const used = identifiersIn(DOMAIN, fn);
      const leaked = PRESENTATION.filter((p) => used.has(p));
      expect(leaked).toEqual([]);
    });
  }

  // The permitted direction, asserted so the guard cannot pass by finding
  // nothing at all -- a guard that would pass on an empty file proves nothing.
  it('presentation IS allowed to depend on the domain', () => {
    const used = identifiersIn(DOMAIN, 'describeEstate');
    expect(used.size).toBeGreaterThan(0);
  });

  it('the domain functions it guards actually exist', () => {
    for (const fn of ['classifyEstate', 'reasonsFor', 'kindsFor', 'estateDigest']) {
      expect(identifiersIn(DOMAIN, fn).size).toBeGreaterThan(0);
    }
  });
});

// scripts/source-facts.ts
// Read JSX attributes from a .tsx file via the AST, never by matching text.
//
// WHY. Guards asserted markup contracts with string containment against a
// hard-coded quote character -- data-testid='dispatch-board', id='cargo',
// role='status', each built from String.fromCharCode(39). Quote style is
// PRESENTATION and Prettier owns it: this repo commits singleQuote:true, which
// governs JS string literals, while JSX attributes keep double quotes (the
// separate jsxSingleQuote option, default false). Formatting the tree flipped
// every JSX attribute to double quotes and five assertions failed at once, with
// the markup contract completely intact.
//
// The property being asserted -- "this element carries this attribute with this
// value" -- is structural. A parser answers it exactly; a substring search
// answers a question about bytes that merely correlates with it, and the
// correlation breaks on reformatting, on an attribute written as a {expression}
// instead of a literal, and on the attribute name appearing inside a comment.
//
// Same lesson as read-jsonc.ts, from the same burndown: the repo's own
// //#assert:parses task exists because "text-matching was satisfied by the
// phrase appearing in a COMMENT", and these guards are that defect in JSX form.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Every literal-valued JSX attribute in a file, as name -> set of values.
 *  Expression-valued attributes (id={foo}) are recorded with value null, so a
 *  caller can distinguish "absent" from "present but computed". */
export function jsxAttributes(path: string): Map<string, Set<string | null>> {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = new Map<string, Set<string | null>>();
  const record = (name: string, value: string | null): void => {
    const bucket = found.get(name) ?? new Set<string | null>();
    bucket.add(value);
    found.set(name, bucket);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const init = node.initializer;
      if (init === undefined) {
        record(name, null);
      } else if (ts.isStringLiteral(init)) {
        record(name, init.text);
      } else if (
        ts.isJsxExpression(init) &&
        init.expression !== undefined &&
        ts.isStringLiteral(init.expression)
      ) {
        // id={'cargo'} is the same contract as id="cargo".
        record(name, init.expression.text);
      } else {
        record(name, null);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** True when the file has <anything name="value"> -- quote style irrelevant. */
export function hasJsxAttribute(path: string, name: string, value: string): boolean {
  return jsxAttributes(path).get(name)?.has(value) ?? false;
}

/** True when the attribute appears at all, with any value. */
export function hasJsxAttributeName(path: string, name: string): boolean {
  return jsxAttributes(path).has(name);
}

/** True when every role="status" element in the file is rendered
 *  UNCONDITIONALLY -- no ancestor conditional expression or logical-&& guard
 *  between it and the component root.
 *
 *  WCAG 4.1.3 / G199: a live region must exist from first paint, because
 *  assistive technology starts monitoring what is present at load and never
 *  notices a region mounted later. So the CONTAINER is static and only its
 *  CONTENT is conditional -- a distinction invisible to a text search, which
 *  can only pin one particular spelling of one particular ternary.
 *
 *  Returns false when no role="status" exists at all: a guard asserting the
 *  live region is static must not pass on a file that has no live region. */
export function liveRegionIsStatic(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let seen = 0;
  let conditional = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'role' &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === 'status'
    ) {
      seen += 1;
      // Walk to the SourceFile, which IS the root. TypeScript types Node.parent
      // as Node rather than Node | undefined, so a `p !== undefined` guard has
      // no type overlap and no-unnecessary-condition rejects it -- correctly:
      // the terminating condition is "reached the file", not "ran out of
      // parents".
      for (let p: ts.Node = node.parent; !ts.isSourceFile(p); p = p.parent) {
        if (ts.isConditionalExpression(p)) {
          conditional += 1;
          break;
        }
        if (
          ts.isBinaryExpression(p) &&
          p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ) {
          conditional += 1;
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return seen > 0 && conditional === 0;
}

/** True when some call to `fnName` whose arguments mention `argSubstring` also
 *  passes an options object containing `option: true`.
 *
 *  WHY STRUCTURAL. The guard this replaces did:
 *    SYNC.split('\n').find((l) => l.includes('refs/terminals/*:refs'))
 *    expect(line).toMatch(/allowFail:\s*true/)
 *  -- requiring the option to sit on the SAME PHYSICAL LINE as the refspec.
 *  That is a line-wrapping fact, owned by Prettier, not a wiring fact. The call
 *  is 89 characters with the refspec alone, so formatting to printWidth 100
 *  moved allowFail onto its own line and the guard failed while the contract
 *  was perfectly intact. Widening the regex to span lines would just move the
 *  fragility; the property is "this call passes this option", which only the
 *  call graph can answer. */
export function callHasOption(
  path: string,
  fnName: string,
  argSubstring: string,
  option: string,
): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === fnName &&
      node.getText().includes(argSubstring)
    ) {
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === option &&
            prop.initializer.kind === ts.SyntaxKind.TrueKeyword
          ) {
            found = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

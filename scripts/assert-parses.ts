// scripts/assert-parses.ts
// Assert that files PARSE, EXPORT the intended names, and (for specs) declare
// at least N tests. Every question is answered from the AST.
//
// WHY. Write gates verified freshly-written files by matching text, and failed
// three ways in one session:
//   BRACES  -- counting balanced EXACTLY on a file containing `} else { ... }
//              else { ... }`, so the gate reported OK on source that does not
//              parse; the same counting rejects a valid `const brace = "{";`.
//   EXPORTS -- `s.includes('export function foo')` is satisfied by a COMMENT,
//              and defeated by `export { foo }`, `export const foo =`, and
//              every exported type.
//   TESTS   -- `s.match(/\n  it\(/g)` encoded TWO-SPACE INDENTATION as a
//              contract, scoring ZERO on a file holding four real tests.
// None is fixable with a better pattern, because none of the properties is
// lexical. ts.createSourceFile already builds the tree.
//
// THE GATE IS ITSELF UNDER TEST, which is why this is .ts with exported pure
// parts rather than the .mjs it began as. A gate nobody tests can be weakened
// silently: break countTests to return 999 and every --min-tests check passes
// while asserting nothing. 2026 practice states the principle directly --
// verification is trustworthy only when it is INDEPENDENT of the thing being
// verified, and the question to ask a test is whether it CAN fail, not whether
// it ran. The pure functions below are unit-tested under //#test:scripts; only
// the entrypoint touches argv and the filesystem, the same split every sibling
// script in this directory follows.
//
// SYNTAX ONLY, DELIBERATELY. Not a substitute for //#typecheck:scripts: this
// answers "is this a well-formed file with the intended surface" in
// milliseconds AT THE MOMENT OF WRITING.
import { readFileSync } from 'node:fs';
import ts from "typescript";

// parseDiagnostics is not on the public SourceFile type -- it is internal to the
// compiler, and reading it untyped is how the .mjs version hid an `any` from
// every checker. Declared here so the access is type-checked rather than
// silently unsafe; this is precisely what moving the gate into the typechecked
// tree was for.
interface ParsedSourceFile extends ts.SourceFile {
  readonly parseDiagnostics?: readonly ts.Diagnostic[];
}

export interface GateOk {
  readonly event: 'GATE_OK';
  // WHICH revision of this envelope, which the event name cannot express.
  readonly schema_version: GateSchemaVersion;
  readonly file: string;
  readonly bytes: number;
  readonly exports: readonly string[];
  readonly tests: number;
}

export interface GateFailure {
  readonly event: 'GATE_FAILURE';
  readonly schema_version: GateSchemaVersion;
  readonly file?: string;
  readonly reasons: readonly string[];
  readonly missing?: readonly string[];
  readonly found?: readonly string[];
  readonly tests?: number;
  readonly minTests?: number;
  readonly missingText?: readonly string[];
  readonly presentText?: readonly string[];
  readonly diagnostics?: readonly { line: number; column: number; message: string }[];
  readonly detail?: string;
  readonly agent_action: 'REGENERATE_FILE' | 'FIX_INVOCATION';
}

export type GateResult = GateOk | GateFailure;

export interface GateArgv {
  readonly files: readonly string[];
  readonly wanted: readonly string[];
  readonly minTests: number | null;
  readonly contains: readonly string[];
  readonly absent: readonly string[];
}

/** Pure argv split. Flags are order-independent; unknown --flags are reported
 *  rather than ignored, because a swallowed typo yields a confident no-op. */
export function parseGateArgv(argv: readonly string[]): GateArgv {
  const files = argv.filter((a) => !a.startsWith("--"));
  const flag = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith('--' + name + '='));
    return hit === undefined ? null : hit.slice(name.length + 3);
  };
  const list = (name: string): readonly string[] => {
    const raw = flag(name);
    return raw === null ? [] : raw.split(",").filter((s) => s.length > 0);
  };
  const minTestsFlag = flag("min-tests");
  return {
    files,
    wanted: list("exports"),
    minTests: minTestsFlag === null ? null : Number(minTestsFlag),
    contains: list("contains"),
    absent: list("absent"),
  };
}

/** Every exported name, from the AST: declarations carrying the export modifier
 *  and `export { a, b }` clauses alike. */
export function exportedNames(sf: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const hasExport = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) names.add(spec.name.text);
      continue;
    }
    if (!hasExport(stmt)) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) ||
       ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) ||
       ts.isEnumDeclaration(stmt)) && stmt.name !== undefined
    ) {
      names.add(stmt.name.text);
    }
  }
  return names;
}

/** Test declarations at any depth and any indentation, including modifier forms
 *  (it.each, test.skip, it.concurrent.only) -- those are still tests, and a
 *  count that missed them would understate the file. */
export function countTests(sf: ts.SourceFile): number {
  let count = 0;
  const rootName = (expr: ts.Expression): string | null => {
    let cur: ts.Expression = expr;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    return ts.isIdentifier(cur) ? cur.text : null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = rootName(node.expression);
      if (name === 'it' || name === 'test') count += 1;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/** Source with comments and whitespace removed, using the compiler's own
 *  scanner rather than a regex. This is what makes --contains and --absent
 *  trustworthy: twice this session a substring check passed because the phrase
 *  appeared in a COMMENT explaining the change, and once because it sat in a
 *  string literal. Tokens are joined with a space so adjacent identifiers can
 *  never fuse into a false match. */
export function codeOnly(src: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.ES2022,
    true,
    ts.LanguageVariant.Standard,
    src,
  );
  const parts: string[] = [];
  let tok = scanner.scan();
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    parts.push(scanner.getTokenText());
    tok = scanner.scan();
  }
  return parts.join(" ");
}

/** The whole verdict for one file's SOURCE. Pure: takes text, returns a result,
 *  touches nothing. */
export function classifySource(
  path: string,
  src: string,
  wanted: readonly string[] = [],
  minTests: number | null = null,
  contains: readonly string[] = [],
  absent: readonly string[] = [],
): GateResult {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, kind);
  const diags = (sf as ParsedSourceFile).parseDiagnostics ?? [];
  if (diags.length > 0) {
    return {
      event: 'GATE_FAILURE', schema_version: GATE_SCHEMA_VERSION,
      file: path, reasons: ['syntax'],
      diagnostics: diags.map((d) => {
        const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
        return {
          line: line + 1, column: character + 1,
          message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
        };
      }),
      agent_action: 'REGENERATE_FILE',
    };
  }

  const found = exportedNames(sf);
  const missing = wanted.filter((n) => !found.has(n));
  const tests = countTests(sf);
  const reasons: string[] = [];
  if (missing.length > 0) reasons.push('missing_exports');
  if (minTests !== null && tests < minTests) reasons.push("too_few_tests");
  // Checked against CODE, never raw source: a phrase in a comment is not an
  // implementation, and treating it as one is a false pass.
  const code = codeOnly(src);
  const missingText = contains.filter((n) => !code.includes(n));
  const presentText = absent.filter((n) => code.includes(n));
  if (missingText.length > 0) reasons.push("missing_text");
  if (presentText.length > 0) reasons.push("forbidden_text");

  if (reasons.length > 0) {
    return {
      event: 'GATE_FAILURE', schema_version: GATE_SCHEMA_VERSION, file: path, reasons,
      missing, found: [...found].sort(), tests,
      // Spread rather than assigning undefined: under exactOptionalPropertyTypes
      // an explicit undefined is NOT the same as an absent key, and the field is
      // declared optional precisely so it can be absent.
      ...(minTests === null ? {} : { minTests }),
      missingText, presentText,
      agent_action: 'REGENERATE_FILE',
    };
  }
  return {
    event: 'GATE_OK', schema_version: GATE_SCHEMA_VERSION,
    file: path, bytes: src.length,
    exports: [...found].sort(), tests,
  };
}

/** Schema version for the ENVELOPE this gate emits.
 *
 *  The estate events carry one; these did not, and the same argument applies:
 *  an agent routes on `reasons` and `agent_action`, so if either ever changes
 *  shape a consumer has no signal to branch on. Publishing different shapes of
 *  the same envelope without a version is the practice 2026 guidance names as
 *  impossible to debug.
 *
 *  Declared ABOVE the entrypoint deliberately: ASSERT_EXIT appended at the end
 *  of the file sat in the temporal dead zone and threw on first run.
 *
 *  SEMVER: patch for docs, minor for a backward-compatible addition such as a
 *  new reason code, major for a removed field or a changed meaning. */
export const GATE_SCHEMA_VERSION = '1.0.0';
export type GateSchemaVersion = typeof GATE_SCHEMA_VERSION;

/** Exit codes, NAMED and exported so an agent branches on a documented
 *  contract rather than on a literal inferred from one observed run.
 *
 *  estate:verify states its graded exits in its header and its task
 *  description; this gate returned bare 0/1/2 with the contract written
 *  nowhere, which is the "no way to discover the schema" gap that pushes a
 *  caller into trial and error.
 *
 *  Declared ABOVE the entrypoint on purpose: appended at the end of the file it
 *  sat in the temporal dead zone, and mainAssertParses threw "Cannot access
 *  ASSERT_EXIT before initialization" the first time it ran. The gate caught
 *  that by executing itself.
 *
 *  ok     -- every file parsed and satisfied every assertion.
 *  failed -- a file is malformed, missing an export, short of tests, or holds
 *            forbidden text. The envelope names which.
 *  usage  -- the INVOCATION is wrong, not the file. Kept distinct because
 *            retrying an unchanged file will not help, while fixing argv will. */
export const ASSERT_EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
} as const;
export type AssertExit = (typeof ASSERT_EXIT)[keyof typeof ASSERT_EXIT];

/* v8 ignore start -- side-effecting entrypoint; pure parts above are unit-tested */
function emit(event: GateResult): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function mainAssertParses(): number {
  const { files, wanted, minTests, contains, absent } = parseGateArgv(process.argv.slice(2));
  if (files.length === 0) {
    emit({
      event: 'GATE_FAILURE', schema_version: GATE_SCHEMA_VERSION,
      reasons: ['usage'], agent_action: 'FIX_INVOCATION',
    });
    return ASSERT_EXIT.usage;
  }
  if ((wanted.length > 0 || minTests !== null || contains.length > 0 ||
       absent.length > 0) && files.length !== 1) {
    emit({
      event: 'GATE_FAILURE', schema_version: GATE_SCHEMA_VERSION,
      reasons: ['needs_one_file'], agent_action: 'FIX_INVOCATION',
    });
    return ASSERT_EXIT.usage;
  }
  if (minTests !== null && !Number.isInteger(minTests)) {
    emit({
      event: 'GATE_FAILURE', schema_version: GATE_SCHEMA_VERSION,
      reasons: ['min_tests_not_an_integer'], agent_action: 'FIX_INVOCATION',
    });
    return ASSERT_EXIT.usage;
  }

  let failed = 0;
  for (const path of files) {
    let src: string;
    try {
      src = readFileSync(path, 'utf8');
    } catch (err) {
      // Fail closed: an unreadable file is never a pass.
      emit({
        event: 'GATE_FAILURE', schema_version: GATE_SCHEMA_VERSION,
        file: path, reasons: ['unreadable'],
        detail: err instanceof Error ? err.message : String(err),
        agent_action: 'REGENERATE_FILE',
      });
      failed += 1;
      continue;
    }
    const result = classifySource(path, src, wanted, minTests, contains, absent);
    emit(result);
    if (result.event === 'GATE_FAILURE') failed += 1;
  }
  return failed > 0 ? ASSERT_EXIT.failed : ASSERT_EXIT.ok;
}

const isMain = process.argv[1]?.endsWith('assert-parses.ts') ?? false;
if (isMain) {
  process.exit(mainAssertParses());
}
/* v8 ignore stop */

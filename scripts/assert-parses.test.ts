// scripts/assert-parses.test.ts
// The gate under test. Until now assert-parses had NO tests, so breaking
// countTests to return 999 would have made every --min-tests check pass while
// asserting nothing -- a gate reduced to decoration, silently.
//
// 2026 practice states the principle: verification is trustworthy only when it
// is INDEPENDENT of the thing being verified, and the question to ask a test is
// whether it CAN fail, not whether it ran. So most of these drive the FAILURE
// paths, and each case is a defect actually observed in this session.
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  parseGateArgv,
  exportedNames,
  countTests,
  classifySource,
  codeOnly,
  ASSERT_EXIT,
  GATE_SCHEMA_VERSION,
} from './assert-parses.ts';

const NL = String.fromCharCode(10);

function parse(src: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

describe('parseGateArgv', () => {
  it('separates files from flags', () => {
    const a = parseGateArgv(['--exports=x,y', 'a.ts', '--min-tests=3', 'b.ts']);
    expect(a.files).toEqual(['a.ts', 'b.ts']);
    expect(a.wanted).toEqual(['x', 'y']);
    expect(a.minTests).toBe(3);
  });

  it('defaults to no expectations', () => {
    const a = parseGateArgv(['a.ts']);
    expect(a.wanted).toEqual([]);
    expect(a.minTests).toBeNull();
  });

  it('ignores an empty exports list rather than demanding an empty name', () => {
    expect(parseGateArgv(['--exports=', 'a.ts']).wanted).toEqual([]);
  });
});

describe('countTests: the property the old regex got wrong', () => {
  // The old /\n  it\(/g scored ZERO on exactly this shape.
  it('counts tests at any indentation and any nesting depth', () => {
    const src = [
      "describe('outer', () => {",
      "describe('nested', () => {",
      "it('flush left', () => {});",
      "        it('deeply indented', () => {});",
      '});',
      '});',
    ].join(NL);
    expect(countTests(parse(src))).toBe(2);
  });

  it('counts modifier forms, which are still tests', () => {
    const src = [
      "it.each([1])('each %i', () => {});",
      "test.skip('skipped', () => {});",
      "it.concurrent.only('conc', () => {});",
    ].join(NL);
    expect(countTests(parse(src))).toBe(3);
  });

  it('counts the test alias as well as it', () => {
    expect(countTests(parse("test('a', () => {});"))).toBe(1);
  });

  // Must NOT be fooled by prose, which is how the substring check failed.
  it('does not count the word it inside a comment or string', () => {
    const src = [
      '// it( looks like a test but is a comment',
      "const s = 'it(';",
      "it('the only real test', () => {});",
    ].join(NL);
    expect(countTests(parse(src))).toBe(1);
  });

  it('returns zero for a file with no tests', () => {
    expect(countTests(parse('export const x = 1;'))).toBe(0);
  });
});

describe('exportedNames: every form, not just declarations', () => {
  it('reads function, const, class, interface and type exports', () => {
    const src = [
      'export function f() {}',
      'export const c = 1;',
      'export class K {}',
      'export interface I { a: string }',
      'export type T = string;',
    ].join(NL);
    expect([...exportedNames(parse(src))].sort())
      .toEqual(['I', 'K', 'T', 'c', 'f']);
  });

  // The form the substring check missed entirely.
  it('reads an export { a, b } clause', () => {
    const src = ['function a() {}', 'function b() {}', 'export { a, b };'].join(NL);
    expect([...exportedNames(parse(src))].sort()).toEqual(['a', 'b']);
  });

  it('does not report a non-exported declaration', () => {
    expect([...exportedNames(parse('function hidden() {}'))]).toEqual([]);
  });

  // The false positive that made the old check meaningless.
  it('does not report a name that appears only in a comment', () => {
    expect([...exportedNames(parse('// export function ghost() {}'))]).toEqual([]);
  });
});

describe('classifySource: the gate CAN fail', () => {
  it('passes a well-formed file', () => {
    const r = classifySource('a.ts', 'export const x = 1;');
    expect(r.event).toBe('GATE_OK');
  });

  // The exact edit that balanced braces and did not parse.
  it('FAILS on a syntax error, naming line and column', () => {
    const r = classifySource('a.ts', ['if (a) {', '} else {', '} else {', '}'].join(NL));
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toContain('syntax');
    expect(r.diagnostics?.[0]?.line).toBe(3);
  });

  // The valid file the old brace counter rejected.
  it('PASSES a brace inside a string literal', () => {
    expect(classifySource('a.ts', 'export const brace = "{";').event).toBe('GATE_OK');
  });

  it('FAILS when a required export is absent', () => {
    const r = classifySource('a.ts', 'export const other = 1;', ['wanted']);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toContain('missing_exports');
    expect(r.missing).toEqual(['wanted']);
  });

  it('FAILS when the file declares too few tests', () => {
    const r = classifySource('a.test.ts', "it('one', () => {});", [], 5);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toContain('too_few_tests');
    expect(r.tests).toBe(1);
    expect(r.minTests).toBe(5);
  });

  it('reports BOTH reasons when both are violated', () => {
    const r = classifySource('a.ts', 'export const other = 1;', ['wanted'], 3);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toEqual(['missing_exports', 'too_few_tests']);
  });

  // Syntax outranks the rest: an unparseable file has no meaningful surface.
  it('reports syntax alone when the file does not parse', () => {
    const r = classifySource('a.ts', 'export const = ;', ['wanted'], 9);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toEqual(['syntax']);
  });

  it('every failure carries an agent action a router can branch on', () => {
    const r = classifySource('a.ts', 'export const = ;');
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.agent_action).toBe('REGENERATE_FILE');
  });
});

// ---- content assertions, checked against CODE ----
// These replace the ad-hoc `node -e '...'` one-liners the write gates used.
// Those were dense, untested, and quoting-fragile: a `!` inside one aborted a
// whole command at PARSE time this session, so the heredoc it guarded never
// ran; avoiding `!` then produced `=== false` comparisons that tripped lint
// three separate times. A registered, tested flag has none of those hazards.
//
// CODE, not raw source. Twice this session a substring check passed because the
// phrase appeared in a COMMENT explaining the very change being verified. The
// compiler's own scanner removes comments, so prose can never satisfy a
// --contains.
describe('codeOnly', () => {
  it('drops line and block comments', () => {
    const src = ['// export function ghost() {}', '/* ghost */', 'const real = 1;'].join(NL);
    const code = codeOnly(src);
    expect(code.includes('ghost')).toBe(false);
    expect(code.includes('real')).toBe(true);
  });

  it('keeps string literals, which ARE code', () => {
    expect(codeOnly('const s = "kept";').includes('kept')).toBe(true);
  });

  it('separates tokens so neighbours cannot fuse into a false match', () => {
    expect(codeOnly('const ab = 1;').includes('constab')).toBe(false);
  });
});

describe('classifySource: content assertions', () => {
  it('PASSES when required text is present in code', () => {
    const r = classifySource('a.ts', 'export const wired = true;', [], null, ['wired']);
    expect(r.event).toBe('GATE_OK');
  });

  // The exact false pass that motivated codeOnly.
  it('FAILS when the required text appears ONLY in a comment', () => {
    const r = classifySource('a.ts', '// wired\nconst other = 1;', [], null, ['wired']);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toContain('missing_text');
    expect(r.missingText).toEqual(['wired']);
  });

  it('FAILS when forbidden text survives in code', () => {
    const r = classifySource('a.ts', 'const oldApi = 1;', [], null, [], ['oldApi']);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toContain('forbidden_text');
    expect(r.presentText).toEqual(['oldApi']);
  });

  // Removing an API while explaining the removal in a comment must PASS.
  it('PASSES when forbidden text remains only in a comment', () => {
    const r = classifySource('a.ts', '// oldApi was removed\nconst n = 1;', [], null, [], ['oldApi']);
    expect(r.event).toBe('GATE_OK');
  });

  it('reports both content reasons at once', () => {
    const r = classifySource('a.ts', 'const oldApi = 1;', [], null, ['newApi'], ['oldApi']);
    if (r.event !== 'GATE_FAILURE') throw new Error('expected failure');
    expect(r.reasons).toEqual(['missing_text', 'forbidden_text']);
  });
});

describe('parseGateArgv: content flags', () => {
  it('reads --contains and --absent as lists', () => {
    const a = parseGateArgv(['--contains=a,b', '--absent=c', 'f.ts']);
    expect(a.contains).toEqual(['a', 'b']);
    expect(a.absent).toEqual(['c']);
  });

  it('defaults both to empty', () => {
    const a = parseGateArgv(['f.ts']);
    expect(a.contains).toEqual([]);
    expect(a.absent).toEqual([]);
  });
});

// ---- queries are TOKEN-shaped, not source-shaped ----
// codeOnly joins tokens with a space, so `!code.includes(n)` in the source
// reads `! code . includes ( n )`. That is deliberate -- it stops adjacent
// identifiers fusing into a false match -- but it means a --contains query must
// be written the way the scanner sees it. This bit the author on first use, so
// it is pinned rather than left as folklore.
describe('codeOnly: token spacing is part of the contract', () => {
  it('separates a member access into its tokens', () => {
    expect(codeOnly('code.includes(n)')).toContain('code . includes');
  });

  it('does NOT contain the un-spaced source spelling', () => {
    expect(codeOnly('code.includes(n)').includes('code.includes')).toBe(false);
  });

  it('separates a negation from its operand', () => {
    expect(codeOnly('!ready')).toContain('! ready');
  });

  // The property the spacing exists to guarantee.
  it('never fuses two adjacent identifiers', () => {
    expect(codeOnly('const ab = 1;').includes('constab')).toBe(false);
  });
});

// ---- the exit contract, documented and pinned ----
// estate:verify states its graded exits in its header and task description;
// this gate returned bare 0/1/2 with the contract written nowhere, which is the
// "no way to discover the schema" gap that pushes a caller into trial and
// error. An agent branching on an exit code needs the code to be a contract,
// not a literal inferred from one observed run.
//
// The constant also had to move ABOVE the entrypoint: appended at the end it
// sat in the temporal dead zone, and the gate threw "Cannot access ASSERT_EXIT
// before initialization" while checking itself.
describe('ASSERT_EXIT', () => {
  it('separates success, failure, and misuse', () => {
    expect(ASSERT_EXIT.ok).toBe(0);
    expect(ASSERT_EXIT.failed).toBe(1);
    expect(ASSERT_EXIT.usage).toBe(2);
  });

  // usage must NOT collapse into failed: retrying an unchanged file cannot fix
  // a wrong invocation, so a caller has to be able to tell them apart.
  it('keeps usage distinct from failed', () => {
    expect(ASSERT_EXIT.usage).not.toBe(ASSERT_EXIT.failed);
  });

  it('reserves 0 for success alone', () => {
    // Compared as numbers: 'as const' narrows the array so .includes(ok) was
    // statically impossible, and tsc rightly called that assertion vacuous.
    const codes: readonly number[] = Object.values(ASSERT_EXIT);
    const zeros = codes.filter((c) => c === 0);
    expect(zeros).toEqual([ASSERT_EXIT.ok]);
  });

  it('every code is distinct, so none can be conflated', () => {
    const codes = Object.values(ASSERT_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ---- the envelope carries its schema version ----
// The estate events carry one; these did not. An agent routes on `reasons` and
// `agent_action`, so if either changes shape a consumer has no signal to branch
// on -- publishing different shapes of the same envelope without a version is
// the practice 2026 guidance names as impossible to debug.
//
// Found by asking the same question of this gate that had just been asked of
// the estate events, rather than filing it for later.
describe('GATE_SCHEMA_VERSION', () => {
  it('is semver, so a consumer can reason about the KIND of change', () => {
    expect(GATE_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('rides on a passing envelope', () => {
    const r = classifySource('a.ts', 'export const x = 1;');
    expect(r.schema_version).toBe(GATE_SCHEMA_VERSION);
  });

  // Failures are the envelopes an agent actually routes on, so they matter most.
  it('rides on a syntax failure', () => {
    const r = classifySource('a.ts', 'export const = ;');
    expect(r.schema_version).toBe(GATE_SCHEMA_VERSION);
  });

  it('rides on an assertion failure', () => {
    const r = classifySource('a.ts', 'export const other = 1;', ['wanted']);
    expect(r.schema_version).toBe(GATE_SCHEMA_VERSION);
  });

  it('is identical across outcomes, since they share one contract revision', () => {
    const versions = new Set([
      classifySource('a.ts', 'export const x = 1;').schema_version,
      classifySource('a.ts', 'export const = ;').schema_version,
      classifySource('a.ts', 'const y = 1;', ['missing']).schema_version,
    ]);
    expect(versions.size).toBe(1);
  });

  it('survives serialisation, so a subscriber reads it off the wire', () => {
    const r = JSON.parse(JSON.stringify(classifySource('a.ts', 'export const x = 1;')));
    expect(r.schema_version).toBe(GATE_SCHEMA_VERSION);
  });

  // Version and event name are independent axes, exactly as for the estate
  // events: the name says WHICH envelope, the version says which revision.
  it('is carried alongside the event name, not encoded into it', () => {
    const r = classifySource('a.ts', 'export const x = 1;');
    expect(r.event).toBe('GATE_OK');
    expect(r.event.includes(GATE_SCHEMA_VERSION)).toBe(false);
  });
});

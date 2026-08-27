// packages/codemods/test/extract-parse-one-number-artifact.test.ts
// Assertions on what the codemod WRITES, not merely on what it reports.
//
// extract-parse-one-number.test.ts checks the returned ProjectChange list: a
// module created, the barrel modified, the origin modified. That list stays
// identical whether the generated file has its header, whether the import names
// the symbol, and whether the barrel was located by suffix or by prefix -- so
// mutation testing found seven survivors in a transform whose whole job is the
// bytes it emits. A codemod is a code GENERATOR; the artifact is the contract.
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { extractParseOneNumber } from '../src/transforms/extract-parse-one-number.js';

const BARREL = '/repo/packages/domain/src/index.ts';
const ORIGIN = '/repo/apps/api/src/parse.ts';
const MODULE = '/repo/packages/domain/src/number-format/parse-one-number.ts';
const FN = 'function parseOneNumber(s: string): number {\n  return Number(s);\n}\n';

function makeProject(opts: { barrel?: boolean } = {}): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  if (opts.barrel !== false) project.createSourceFile(BARREL, 'export {};\n');
  project.createSourceFile(ORIGIN, FN);
  return project;
}

describe('the generated module is a real, well-formed file', () => {
  // Kills the header StringLiteral mutant. Every source file in this repo opens
  // with its own path; a generated file that drops it is indistinguishable from
  // a hand-written one, which is exactly what the convention exists to prevent.
  it('opens with the file-path banner the repo convention requires', () => {
    const project = makeProject();
    extractParseOneNumber(project);
    const text = project.getSourceFileOrThrow(MODULE).getFullText();
    expect(text.startsWith('// packages/domain/src/number-format/parse-one-number.ts')).toBe(true);
  });

  // Kills the `+ '\n'` StringLiteral mutant. POSIX wants a trailing newline and
  // the repo's end-of-file-fixer hook enforces it -- a generated file without
  // one is rewritten by the next commit, producing spurious diffs.
  it('ends with a trailing newline', () => {
    const project = makeProject();
    extractParseOneNumber(project);
    expect(project.getSourceFileOrThrow(MODULE).getFullText().endsWith('\n')).toBe(true);
  });

  it('exports the relocated function', () => {
    const project = makeProject();
    extractParseOneNumber(project);
    const fn = project.getSourceFileOrThrow(MODULE).getFunctionOrThrow('parseOneNumber');
    expect(fn.isExported()).toBe(true);
  });

  // Kills `overwrite: true` -> false. Without overwrite, a re-run against a
  // project that already has the module throws instead of regenerating -- which
  // is the difference between an idempotent codemod and a single-use one.
  it('regenerates over an existing module instead of throwing', () => {
    const project = makeProject();
    project.createSourceFile(MODULE, '// stale content\n');
    expect(() => extractParseOneNumber(project)).not.toThrow();
    expect(project.getSourceFileOrThrow(MODULE).getFullText()).not.toContain('stale content');
  });
});

describe('the origin is rewritten to import from the barrel', () => {
  // Kills `namedImports: [TARGET]` -> []. A bare `import '@fleet/domain';` is
  // still an import declaration, so the change list looks identical -- but the
  // origin no longer resolves parseOneNumber and stops compiling.
  it('names the extracted symbol in the inserted import', () => {
    const project = makeProject();
    extractParseOneNumber(project);
    const decl = project
      .getSourceFileOrThrow(ORIGIN)
      .getImportDeclarations()
      .find((d) => d.getModuleSpecifierValue() === '@fleet/domain');
    expect(decl?.getNamedImports().map((n) => n.getName())).toEqual(['parseOneNumber']);
  });

  it('removes the function from the origin', () => {
    const project = makeProject();
    extractParseOneNumber(project);
    expect(project.getSourceFileOrThrow(ORIGIN).getFunction('parseOneNumber')).toBeUndefined();
  });
});

describe('the barrel is located by SUFFIX, not by prefix', () => {
  // Kills `.endsWith` -> `.startsWith`. In-memory paths begin with '/repo', so
  // startsWith('/packages/domain/src/index.ts') matches nothing and the
  // transform throws its barrel-missing error -- which also kills the error
  // StringLiteral mutant, since the message is what identifies the failure.
  it('finds a barrel whose path merely ends with the expected suffix', () => {
    const project = makeProject();
    expect(() => extractParseOneNumber(project)).not.toThrow();
  });

  it('names the missing barrel explicitly when there is none', () => {
    const project = makeProject({ barrel: false });
    expect(() => extractParseOneNumber(project)).toThrow(
      /@fleet\/domain barrel \(packages\/domain\/src\/index\.ts\) not found/,
    );
  });
});

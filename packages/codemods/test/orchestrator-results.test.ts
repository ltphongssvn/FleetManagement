// packages/codemods/test/orchestrator-results.test.ts
// The PER-FILE results array and the dryRun contract, which the existing suite
// exercised but never inspected.
//
// orchestrator.test.ts asserts the AGGREGATES -- scanned, changed, errored --
// and those stay correct while every per-file `changed` flag is inverted,
// because the counters are incremented separately from the entries pushed into
// results. Mutation testing found seven survivors here on exactly that seam.
//
// The results array is the part consumers read: --check derives drift from it,
// and a caller deciding what to re-run reads it file by file. A summary that
// says "1 changed" while naming the wrong file is worse than no summary.
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { runCodemod, runProjectCodemod } from '../src/orchestrator.js';

function projectWith(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  return project;
}

const CHANGED = '/src/a.ts';
const UNCHANGED = '/src/b.ts';

function twoFileProject(): Project {
  return projectWith({ [CHANGED]: 'const a = 1;\n', [UNCHANGED]: 'const b = 2;\n' });
}

// Marks a.ts changed, leaves b.ts alone.
const selectiveTransform = (sf: { getFilePath(): string }): { changed: boolean } => ({
  changed: sf.getFilePath() === CHANGED,
});

describe('runCodemod reports WHICH file changed, not just how many', () => {
  // Kills both BooleanLiteral mutants on the results.push calls (lines 57/59).
  // Inverting either leaves scanned/changed/errored untouched, so only a
  // per-entry assertion can see it.
  it('flags the changed file true and the untouched file false', () => {
    const r = runCodemod({
      project: twoFileProject(),
      transform: selectiveTransform,
      dryRun: true,
    });
    const byPath = new Map(r.results.map((x) => [x.filePath, x.changed]));
    expect(byPath.get(CHANGED)).toBe(true);
    expect(byPath.get(UNCHANGED)).toBe(false);
  });

  it('keeps the aggregate consistent with the per-file entries', () => {
    const r = runCodemod({
      project: twoFileProject(),
      transform: selectiveTransform,
      dryRun: true,
    });
    expect(r.results.filter((x) => x.changed).length).toBe(r.changed);
  });
});

describe('runCodemod records an errored file as NOT changed', () => {
  const throwing = (): never => {
    throw new Error('boom');
  };

  // Kills the BooleanLiteral mutant at line 64. A file whose transform threw
  // produced no edit, so reporting changed:true would tell --check that drift
  // exists and tell a caller to re-read a file that was never written.
  it('marks the entry changed:false and carries the message', () => {
    const r = runCodemod({ project: projectWith({ [CHANGED]: 'x\n' }), transform: throwing });
    expect(r.results[0]?.changed).toBe(false);
    expect(r.results[0]?.error).toBe('boom');
  });

  // Kills the StringLiteral mutant at line 63: without the prefix the message
  // is a bare JSON blob with no indication that the thrown value was not an
  // Error, which is the one fact that explains why there is no stack.
  it('labels a non-Error throw as such', () => {
    const throwingValue = (): never => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw { code: 42 };
    };
    const r = runCodemod({ project: projectWith({ [CHANGED]: 'x\n' }), transform: throwingValue });
    expect(r.results[0]?.error).toBe('non-Error thrown: {"code":42}');
  });
});

describe('runProjectCodemod honours dryRun', () => {
  const MODULE = '/src/generated.ts';
  const addFile = (project: Project): readonly { filePath: string; change: 'created' }[] => {
    project.createSourceFile(MODULE, '// generated\n', { overwrite: true });
    return [{ filePath: MODULE, change: 'created' }];
  };

  // Kills `const dryRun = options.dryRun === true` -> `true` (line 77) and the
  // `if (!dryRun)` mutants (line 79). With dryRun forced true the project is
  // never saved, so the file exists only in memory.
  it('writes the project to disk when dryRun is not set', () => {
    const project = projectWith({});
    runProjectCodemod({ project, transform: addFile });
    expect(project.getFileSystem().fileExistsSync(MODULE)).toBe(true);
  });

  // Kills the BlockStatement mutant at line 79 (`if (!dryRun) {}`): emptying
  // the block makes every run behave like a dry run.
  it('leaves the disk untouched when dryRun is set', () => {
    const project = projectWith({});
    runProjectCodemod({ project, transform: addFile, dryRun: true });
    expect(project.getFileSystem().fileExistsSync(MODULE)).toBe(false);
  });

  it('reports dryRun back to the caller', () => {
    const project = projectWith({});
    expect(runProjectCodemod({ project, transform: addFile, dryRun: true }).dryRun).toBe(true);
    expect(runProjectCodemod({ project: projectWith({}), transform: addFile }).dryRun).toBe(false);
  });
});

// packages/codemods/test/transforms/extract-parse-one-number.test.ts
// Outside-in RED for the project-level extract-parse-one-number transform: move
// parseOneNumber out of its origin file into a new @fleet/domain module, re-export it from
// the domain barrel, and rewrite the origin to import it from @fleet/domain. Driven via the
// project-level orchestrator (runProjectCodemod) with dryRun honored.
// RED: ../../src/transforms/extract-parse-one-number.js and orchestrator.runProjectCodemod
// do not exist yet.
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { runProjectCodemod } from '../../src/orchestrator.js';
import { extractParseOneNumber } from '../../src/transforms/extract-parse-one-number.js';

const ORIGIN = `export function parseOneNumber(raw: string): number | null {
  const cleaned = raw.replace(/kg/gi, '').trim();
  return cleaned.length > 0 ? Number(cleaned) : null;
}

export function parseNetWeightKg(rawValue: string): number | null {
  return parseOneNumber(rawValue);
}
`;

const ORIGIN_PATH = '/workers/main-worker/src/extraction/extraction-policy.ts';
const MODULE_PATH = '/packages/domain/src/number-format/parse-one-number.ts';

function buildProject(): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  const fs = project.getFileSystem();
  fs.writeFileSync('/packages/domain/src/index.ts', 'export {};\n');
  fs.writeFileSync(ORIGIN_PATH, ORIGIN);
  project.addSourceFilesAtPaths('/**/*.ts');
  return project;
}

describe('extract-parse-one-number transform', () => {
  it('moves parseOneNumber into a new @fleet/domain module and rewrites the origin import', () => {
    const project = buildProject();
    const result = runProjectCodemod({ project, transform: extractParseOneNumber, dryRun: false });

    const moduleFile = project.getSourceFile(MODULE_PATH);
    expect(moduleFile).toBeDefined();
    expect(moduleFile?.getFullText()).toContain('export function parseOneNumber');

    const barrel = project.getSourceFileOrThrow('/packages/domain/src/index.ts');
    expect(barrel.getFullText()).toContain('./number-format/parse-one-number');

    const origin = project.getSourceFileOrThrow(ORIGIN_PATH);
    expect(origin.getFullText()).toContain('@fleet/domain');
    expect(origin.getFullText().includes('function parseOneNumber')).toBe(false);

    const kinds = result.changes.map((c) => c.change);
    expect(kinds).toContain('created');
    expect(kinds).toContain('modified');
  });

  it('is idempotent — a second run reports no changes', () => {
    const project = buildProject();
    runProjectCodemod({ project, transform: extractParseOneNumber, dryRun: false });
    const second = runProjectCodemod({ project, transform: extractParseOneNumber, dryRun: false });
    expect(second.changes).toHaveLength(0);
  });

  it('dryRun does not write the new module to disk', () => {
    const project = buildProject();
    const result = runProjectCodemod({ project, transform: extractParseOneNumber, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.changes.some((c) => c.change === 'created')).toBe(true);
    expect(() => project.getFileSystem().readFileSync(MODULE_PATH)).toThrow();
  });

  it('throws when the @fleet/domain barrel is missing', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.getFileSystem().writeFileSync(ORIGIN_PATH, ORIGIN);
    project.addSourceFilesAtPaths('/**/*.ts');
    expect(() => runProjectCodemod({ project, transform: extractParseOneNumber, dryRun: false })).toThrow();
  });
});

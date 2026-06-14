// packages/codemods/test/orchestrator.test.ts
// Outside-in tests for the workspace orchestrator. runCodemod applies a transform across
// every SOURCE file in a ts-morph Project (skipping generated declaration files and dist
// output) with per-file error isolation (one failing file never aborts the run), honors
// dryRun (no writes to disk), saves changed files when not dryRun, and returns a
// Zod-validated summary.
import { describe, it, expect } from 'vitest';
import { Project, type SourceFile } from 'ts-morph';
import { runCodemod } from '../src/orchestrator.js';
import { transformParseOneNumber } from '../src/transforms/parse-one-number.js';
import { type TransformOutcome, OrchestratorResultSchema } from '../src/contracts.js';

const PRIVATE = 'function parseOneNumber(){ return 0; }\n';
const EXPORTED = 'export function parseOneNumber(){ return 0; }\n';

function projectWith(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  const fs = project.getFileSystem();
  for (const [name, text] of Object.entries(files)) fs.writeFileSync('/' + name, text);
  project.addSourceFilesAtPaths('/**/*.ts');
  return project;
}

describe('runCodemod orchestrator', () => {
  it('applies the transform across files and returns a schema-valid summary', () => {
    const project = projectWith({ 'a.ts': PRIVATE, 'b.ts': PRIVATE, 'c.ts': 'export const x = 1;\n' });
    const result = runCodemod({ project, transform: transformParseOneNumber, dryRun: true });
    expect(() => OrchestratorResultSchema.parse(result)).not.toThrow();
    expect(result.scanned).toBe(3);
    expect(result.changed).toBe(2);
    expect(result.errored).toBe(0);
  });

  it('dryRun leaves files unchanged on disk', () => {
    const project = projectWith({ 'a.ts': PRIVATE });
    const result = runCodemod({ project, transform: transformParseOneNumber, dryRun: true });
    expect(result.changed).toBe(1);
    expect(project.getFileSystem().readFileSync('/a.ts')).toBe(PRIVATE);
  });

  it('non-dryRun saves changed files to disk', () => {
    const project = projectWith({ 'a.ts': PRIVATE });
    const result = runCodemod({ project, transform: transformParseOneNumber, dryRun: false });
    expect(result.changed).toBe(1);
    expect(project.getFileSystem().readFileSync('/a.ts')).toBe(EXPORTED);
  });

  it('isolates per-file errors: one throwing file does not abort the run', () => {
    const project = projectWith({ 'good.ts': PRIVATE, 'bad.ts': PRIVATE });
    const boom = (sf: SourceFile): TransformOutcome => {
      if (sf.getFilePath().endsWith('bad.ts')) throw new Error('boom on bad');
      return transformParseOneNumber(sf);
    };
    const result = runCodemod({ project, transform: boom, dryRun: false });
    expect(result.scanned).toBe(2);
    expect(result.changed).toBe(1);
    expect(result.errored).toBe(1);
    const bad = result.results.find((r) => r.filePath.endsWith('bad.ts'));
    expect(bad?.error).toContain('boom on bad');
  });

  it('records non-Error throws in the summary', () => {
    const project = projectWith({ 'x.ts': PRIVATE });
    const boom = (_sf: SourceFile): TransformOutcome => {
      const failure: unknown = 'plain failure';
      throw failure;
    };
    const result = runCodemod({ project, transform: boom, dryRun: false });
    expect(result.errored).toBe(1);
    expect(result.results[0]?.error).toContain('plain failure');
  });

  it('skips declaration files and dist output, scanning only real source', () => {
    const project = projectWith({
      'a.ts': PRIVATE,
      'types.d.ts': 'export declare const y: number;\n',
      'dist/built.ts': PRIVATE,
      'node_modules/dep.ts': PRIVATE,
    });
    const result = runCodemod({ project, transform: transformParseOneNumber, dryRun: true });
    expect(result.scanned).toBe(1);
    expect(result.changed).toBe(1);
    const paths = result.results.map((r) => r.filePath);
    expect(paths.some((p) => p.endsWith('/a.ts'))).toBe(true);
    expect(paths.some((p) => p.includes('.d.ts'))).toBe(false);
    expect(paths.some((p) => p.includes('/dist/'))).toBe(false);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });
});

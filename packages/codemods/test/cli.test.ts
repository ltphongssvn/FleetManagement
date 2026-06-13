// packages/codemods/test/cli.test.ts
// Outside-in RED for CLI dispatch by codemod kind. runCodemodCli routes a 'per-file'
// codemod through runCodemod (OrchestratorResult: has `scanned`) and a 'project' codemod
// through runProjectCodemod (ProjectOutcome: has `changes`, no `scanned`). Importing the
// CLI module must not execute main() as a side effect.
// RED: ../src/cli.js does not export runCodemodCli yet.
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { runCodemodCli, hasDrift } from '../src/cli.js';
import { getCodemod } from '../src/registry.js';
import { OrchestratorResultSchema, ProjectOutcomeSchema } from '../src/contracts.js';

function inMemoryProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  const fs = project.getFileSystem();
  for (const [name, text] of Object.entries(files)) fs.writeFileSync('/' + name, text);
  project.addSourceFilesAtPaths('/**/*.ts');
  return project;
}

describe('runCodemodCli dispatch', () => {
  it('routes a per-file codemod through runCodemod (OrchestratorResult)', () => {
    const codemod = getCodemod('parse-one-number');
    if (codemod === undefined) throw new Error('parse-one-number not registered');
    expect(codemod.kind).toBe('per-file');
    const project = inMemoryProject({ 'a.ts': 'function parseOneNumber(){ return 0; }\n' });
    const result = runCodemodCli(codemod, project, true);
    expect(() => OrchestratorResultSchema.parse(result)).not.toThrow();
    expect('scanned' in result).toBe(true);
  });

  it('spans extra include globs into the project before running (project codemod sees added source)', () => {
    const codemod = getCodemod('extract-parse-one-number');
    if (codemod === undefined) throw new Error('extract-parse-one-number not registered');
    const project = inMemoryProject({
      'workers/w/origin.ts': 'export function parseOneNumber(){ return 0; }\n',
    });
    const fs = project.getFileSystem();
    fs.writeFileSync('/packages/domain/src/index.ts', 'export const domain = 1;\n');
    const before = project.getSourceFile('/packages/domain/src/index.ts');
    expect(before).toBeUndefined();
    const result = runCodemodCli(codemod, project, true, ['/packages/domain/src/**/*.ts']);
    expect(() => ProjectOutcomeSchema.parse(result)).not.toThrow();
    expect(project.getSourceFile('/packages/domain/src/index.ts')).toBeDefined();
  });

  it('routes a project codemod through runProjectCodemod (ProjectOutcome)', () => {
    const codemod = getCodemod('extract-parse-one-number');
    if (codemod === undefined) throw new Error('extract-parse-one-number not registered');
    expect(codemod.kind).toBe('project');
    const project = inMemoryProject({ 'unrelated.ts': 'export const x = 1;\n' });
    const result = runCodemodCli(codemod, project, true);
    expect(() => ProjectOutcomeSchema.parse(result)).not.toThrow();
    expect('changes' in result).toBe(true);
    expect('scanned' in result).toBe(false);
  });
});


describe('hasDrift (--check drift detection)', () => {
  it('per-file: drift when any file changed', () => {
    expect(hasDrift({ dryRun: true, scanned: 2, changed: 1, errored: 0, results: [] })).toBe(true);
  });

  it('per-file: no drift when nothing changed', () => {
    expect(hasDrift({ dryRun: true, scanned: 2, changed: 0, errored: 0, results: [] })).toBe(false);
  });

  it('per-file: errors count as drift (cannot prove clean)', () => {
    expect(hasDrift({ dryRun: true, scanned: 2, changed: 0, errored: 1, results: [] })).toBe(true);
  });

  it('project: drift when there are changes', () => {
    expect(hasDrift({ dryRun: true, changes: [{ filePath: '/x.ts', change: 'modified' }] })).toBe(true);
  });

  it('project: no drift when changes is empty', () => {
    expect(hasDrift({ dryRun: true, changes: [] })).toBe(false);
  });
});

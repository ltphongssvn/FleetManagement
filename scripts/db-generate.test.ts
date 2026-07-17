// ============================================================================
// File:     FleetManagement/scripts/db-generate.test.ts
// Purpose:  RED for the db:generate output guard. drizzle-kit reports fatal
//           schema-load errors on stdout/stderr and STILL EXITS 0, so turbo
//           prints Tasks: 1 successful on a crash and CI cannot see the
//           failure. This is not hypothetical: db:generate was broken on main
//           from PR #313 (manifest.ts began importing @fleet/domain, which
//           drizzle-kit CJS could not resolve) until PR #333, and nothing went
//           red for days.
// Related:  scripts/db-generate.ts, turbo.jsonc (db:generate task)
// ============================================================================
import { describe, it, expect } from 'vitest';
import { decideDbGenerate, DB_GENERATE_FAILURE_REASONS } from './db-generate.js';
describe('decideDbGenerate', () => {
  it('fails on ERR_PACKAGE_PATH_NOT_EXPORTED even when drizzle-kit exits 0', () => {
    const verdict = decideDbGenerate({
      exitCode: 0,
      output: [
        'Reading config file /repo/apps/api/drizzle.config.ts',
        'Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No exports main defined in /repo/node_modules/@fleet/domain/package.json',
      ].join(String.fromCharCode(10)),
    });
    expect(verdict).toEqual({ action: 'fail', reasons: ['module-resolution'] });
  });
  it('fails on a generic thrown Error even when drizzle-kit exits 0', () => {
    const verdict = decideDbGenerate({
      exitCode: 0,
      output: 'Error: Cannot read properties of undefined (reading a)',
    });
    expect(verdict).toEqual({ action: 'fail', reasons: ['error-output'] });
  });
  it('fails on a non-zero exit even when the output looks clean', () => {
    const verdict = decideDbGenerate({ exitCode: 1, output: 'No schema changes, nothing to migrate' });
    expect(verdict).toEqual({ action: 'fail', reasons: ['nonzero-exit'] });
  });
  it('accumulates every reason rather than short-circuiting on the first', () => {
    const verdict = decideDbGenerate({
      exitCode: 1,
      output: 'Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No exports main defined',
    });
    expect(verdict.action).toBe('fail');
    expect(verdict.reasons).toEqual(['nonzero-exit', 'module-resolution']);
  });
  it('passes when drizzle-kit reports no schema changes', () => {
    const verdict = decideDbGenerate({
      exitCode: 0,
      output: 'transport_order 16 columns 4 indexes 0 fks' + String.fromCharCode(10) + 'No schema changes, nothing to migrate',
    });
    expect(verdict).toEqual({ action: 'pass', reasons: [] });
  });
  it('passes when drizzle-kit emits a migration', () => {
    const verdict = decideDbGenerate({
      exitCode: 0,
      output: 'Your SQL migration file has been created 0030_brave_wasp.sql',
    });
    expect(verdict).toEqual({ action: 'pass', reasons: [] });
  });
  it('fails when the run produced neither a success marker nor an error (silent no-op)', () => {
    const verdict = decideDbGenerate({ exitCode: 0, output: 'Reading config file drizzle.config.ts' });
    expect(verdict).toEqual({ action: 'fail', reasons: ['no-success-marker'] });
  });
  it('does not treat the word error inside a table or column name as a failure', () => {
    const verdict = decideDbGenerate({
      exitCode: 0,
      output: 'error_log 5 columns 1 indexes 0 fks' + String.fromCharCode(10) + 'No schema changes, nothing to migrate',
    });
    expect(verdict).toEqual({ action: 'pass', reasons: [] });
  });
  it('exposes its reason vocabulary as a readonly SSOT', () => {
    expect([...DB_GENERATE_FAILURE_REASONS]).toEqual([
      'nonzero-exit',
      'module-resolution',
      'error-output',
      'no-success-marker',
    ]);
  });
});

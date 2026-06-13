// packages/codemods/test/cli-options.test.ts
// Outside-in RED for the CLI option contract. parseCliArgs maps argv -> a Zod-validated
// CliOptions: a positional transform name (constrained to the registry), --tsconfig /
// --project <path>, and --dry / --dry-run. Unknown or missing transform throws.
// RED: ../src/cli-options.js does not exist yet.
import { describe, it, expect } from 'vitest';
import { parseCliArgs, CliOptionsSchema } from '../src/cli-options.js';

describe('parseCliArgs', () => {
  it('parses a bare transform name with defaults', () => {
    expect(parseCliArgs(['parse-one-number'])).toMatchObject({
      transform: 'parse-one-number',
      tsConfigFilePath: 'tsconfig.json',
      dryRun: false,
    });
  });

  it('accepts --dry and --dry-run as the dry flag', () => {
    expect(parseCliArgs(['parse-one-number', '--dry']).dryRun).toBe(true);
    expect(parseCliArgs(['parse-one-number', '--dry-run']).dryRun).toBe(true);
  });

  it('accepts --tsconfig and --project with a path value', () => {
    expect(parseCliArgs(['parse-one-number', '--tsconfig', 'apps/api/tsconfig.json']).tsConfigFilePath).toBe('apps/api/tsconfig.json');
    expect(parseCliArgs(['parse-one-number', '--project', 'packages/domain/tsconfig.json']).tsConfigFilePath).toBe('packages/domain/tsconfig.json');
  });

  it('rejects an unknown transform name', () => {
    expect(() => parseCliArgs(['not-a-real-codemod'])).toThrow();
  });

  it('rejects when no transform is given', () => {
    expect(() => parseCliArgs(['--dry'])).toThrow();
  });

  it('defaults include to an empty array', () => {
    expect(parseCliArgs(['parse-one-number']).include).toEqual([]);
  });

  it('defaults check to false', () => {
    expect(parseCliArgs(['parse-one-number']).check).toBe(false);
  });

  it('parses --check as a boolean flag', () => {
    expect(parseCliArgs(['parse-one-number', '--check']).check).toBe(true);
  });

  it('--check implies a dry (non-writing) run', () => {
    const opts = parseCliArgs(['extract-parse-one-number', '--check']);
    expect(opts.check).toBe(true);
    expect(opts.dryRun).toBe(true);
  });

  it('accumulates --include globs in order, repeatable', () => {
    const opts = parseCliArgs([
      'extract-parse-one-number',
      '--include',
      'packages/domain/src/**/*.ts',
      '--include',
      'packages/other/src/**/*.ts',
    ]);
    expect(opts.include).toEqual(['packages/domain/src/**/*.ts', 'packages/other/src/**/*.ts']);
  });

  it('exposes a strict schema that rejects unknown keys', () => {
    expect(() => CliOptionsSchema.parse({ transform: 'parse-one-number', tsConfigFilePath: 'tsconfig.json', dryRun: false, include: [], check: false, extra: 1 })).toThrow();
  });
});

// packages/test-fixtures/test/jsonc-fixtures.test.ts
// The JSONC reader that replaced FIVE hand-rolled copies across this repo.
//
// Each copy stripped every line whose first token is // and then called
// JSON.parse. That is wrong twice: a turbo ROOT TASK is spelled //#, so the
// stripper deleted all 47 root-task definitions before parsing; and Prettier's
// committed trailingComma:"all" emits `},`, which JSON.parse rejects outright.
// The cases below pin both, because a reader that merely "works today" is what
// the five copies also looked like.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonc, readJsonc, readTurboTasks } from '../src/jsonc-fixtures.js';

function withFile(contents: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'jsonc-'));
  const path = join(dir, 'sample.jsonc');
  writeFileSync(path, contents);
  try {
    run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('parseJsonc', () => {
  it('parses plain JSON', () => {
    expect(parseJsonc('{"a": 1}', 'x.jsonc')).toEqual({ a: 1 });
  });

  it('ignores line comments', () => {
    expect(parseJsonc('{\n // note\n "a": 1\n}', 'x.jsonc')).toEqual({ a: 1 });
  });

  it('ignores block comments', () => {
    expect(parseJsonc('{\n /* note */ "a": 1\n}', 'x.jsonc')).toEqual({ a: 1 });
  });

  // The defect that broke four guards the moment the repo was formatted.
  it('accepts trailing commas, which JSON.parse rejects', () => {
    expect(parseJsonc('{\n "a": 1,\n}', 'x.jsonc')).toEqual({ a: 1 });
  });

  // The defect that made those same guards vacuous for their whole lives: a
  // key beginning with // is DATA, not a comment, and only a parser knows it.
  it('preserves keys that begin with the comment marker', () => {
    const parsed = parseJsonc('{"//#format": 1, "//#knip": 2}', 'x.jsonc') as Record<
      string,
      number
    >;
    expect(Object.keys(parsed)).toEqual(['//#format', '//#knip']);
  });

  it('preserves a // sequence inside a string VALUE', () => {
    expect(parseJsonc('{"url": "https://example.test/x"}', 'x.jsonc')).toEqual({
      url: 'https://example.test/x',
    });
  });

  it('throws with the path and the parser diagnostic on malformed input', () => {
    expect(() => parseJsonc('{ not json', 'broken.jsonc')).toThrow(/broken\.jsonc/);
  });
});

describe('readJsonc', () => {
  it('reads and parses a file from disk', () => {
    withFile('{\n // c\n "a": 1,\n}', (p) => {
      expect(readJsonc(p)).toEqual({ a: 1 });
    });
  });
});

describe('readTurboTasks', () => {
  it('returns the task table', () => {
    withFile('{"tasks": {"build": {"dependsOn": ["^build"]}}}', (p) => {
      expect(readTurboTasks(p)['build']?.dependsOn).toEqual(['^build']);
    });
  });

  it('returns root tasks whose names begin with the comment marker', () => {
    withFile('{"tasks": {"//#format": {"cache": false}}}', (p) => {
      expect(readTurboTasks(p)['//#format']).toBeDefined();
    });
  });

  // FAILS CLOSED. An empty table would make every "task X is registered"
  // assertion fail confusingly and every "task X is absent" assertion pass
  // vacuously -- which is exactly how the five copies hid their own damage.
  it('throws on an empty task table rather than returning it', () => {
    withFile('{"tasks": {}}', (p) => {
      expect(() => readTurboTasks(p)).toThrow(/empty/);
    });
  });

  it('throws when there is no tasks key at all', () => {
    withFile('{"other": 1}', (p) => {
      expect(() => readTurboTasks(p)).toThrow(/no tasks key/);
    });
  });

  it('throws when tasks is not an object', () => {
    withFile('{"tasks": 42}', (p) => {
      expect(() => readTurboTasks(p)).toThrow(/not an object/);
    });
  });
});

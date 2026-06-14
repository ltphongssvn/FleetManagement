// packages/codemods/test/contracts.test.ts
// RED: the parse-one-number transform must return an outcome that satisfies the
// Zod contract (TransformOutcomeSchema) — schema is the runtime source of truth,
// not just a compile-time type. Drives parseOutcome() validation into the transform.
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { TransformOutcomeSchema } from '../src/contracts.js';
import { transformParseOneNumber } from '../src/transforms/parse-one-number.js';

function run(src: string): unknown {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile('x.ts', src);
  return transformParseOneNumber(sf);
}

describe('TransformOutcome contract', () => {
  it('changed-path outcome parses against the schema', () => {
    const outcome = run('function parseOneNumber(){ return 0; }');
    expect(() => TransformOutcomeSchema.parse(outcome)).not.toThrow();
    expect(TransformOutcomeSchema.parse(outcome).changed).toBe(true);
  });

  it('no-op outcome parses against the schema', () => {
    const outcome = run('export function parseOneNumber(){ return 0; }');
    expect(TransformOutcomeSchema.parse(outcome).changed).toBe(false);
  });

  it('rejects unknown keys (strict contract)', () => {
    expect(() => TransformOutcomeSchema.parse({ changed: true, extra: 1 })).toThrow();
  });
});

// packages/codemods/test/transforms/parse-one-number.test.ts
// Outside-in RED (fixture-driven) for the parse-one-number codemod.
// Contract (grounded in extraction-policy.ts's goal that the number-format rules be
// "testable + auditable", and that parseOneNumber is currently PRIVATE and reachable
// only via parseNetWeightKg): the transform PROMOTES parseOneNumber to an EXPORTED
// declaration. Inserting the export modifier is the canonical reference-safe edit
// where ts-morph beats fragile text replacement.
// RED reason: ../../src/transforms/parse-one-number.js does not exist yet.
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformParseOneNumber } from '../../src/transforms/parse-one-number.js';

const here = dirname(fileURLToPath(import.meta.url));
const fxDir = resolve(here, '__testfixtures__/parse-one-number');
const input = readFileSync(resolve(fxDir, 'input.ts'), 'utf8');
const expected = readFileSync(resolve(fxDir, 'output.ts'), 'utf8');

describe('parse-one-number codemod', () => {
  // 90s timeout (raised from the 30s default): under the pre-push gate all
  // packages run vitest --coverage in parallel on this WSL2 box, and the
  // ts-morph in-memory Project here is CPU-heavy -- observed 34s purely from
  // contention while passing in ~1s isolated. Same class + remedy as the
  // documented ops-web jsdom testTimeout raise; prevents flaky gate REDs
  // without masking real hangs.
  it('promotes the private parseOneNumber to an exported declaration', { timeout: 90_000 }, () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('extraction-policy.ts', input);
    const outcome = transformParseOneNumber(sf);
    expect(sf.getFullText()).toBe(expected);
    expect(outcome.changed).toBe(true);
  });

  it('is idempotent — re-running on exported source makes no change', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('extraction-policy.ts', expected);
    const outcome = transformParseOneNumber(sf);
    expect(sf.getFullText()).toBe(expected);
    expect(outcome.changed).toBe(false);
  });
});

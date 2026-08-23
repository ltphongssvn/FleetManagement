// apps/api/test/ci-workflow-shell-parse.test.ts
// Business invariant (permanent rule): every GitHub Actions workflow's inline
// shell (run: blocks) MUST be valid POSIX sh. A literal backslash escape before
// a dollar, double-quote, or another backslash inside a YAML run: | literal
// block is written verbatim to the shell, so an escaped dollar-paren becomes a
// bare open-paren and dash fails with exit 2 BEFORE any step logic runs (real
// incident: E2E run 26721934438 — wait-for-health step). Guard: extract every
// run: block from each workflow, syntax-check it with sh -n, and forbid the
// backslash-escape bytes that caused the incident. No third-party YAML dep: a
// minimal literal-block extractor reads run: bodies.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const WF_DIR = join(REPO_ROOT, '.github', 'workflows');

const BS = String.fromCharCode(92);
const DOL = String.fromCharCode(36);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);
const NL = String.fromCharCode(10);
const BAD_ESCAPES = [BS + DOL, BS + DQ, BS + BS];

interface Block {
  step: string;
  script: string;
}

// Extract YAML literal/folded block scalars introduced by run: | or run: >
// (with optional chomping/indentation indicators). Captures the indented body
// until a line dedents at or below the run: key indent. Also captures the
// nearest preceding name: for diagnostics. Sufficient for CI run blocks and
// avoids a runtime YAML dependency. All indexed access is guarded (strict
// noUncheckedIndexedAccess): no non-null assertions, no casts.
function extractRunBlocks(text: string): Block[] {
  const lines = text.split(NL);
  const blocks: Block[] = [];
  let lastName = '(unnamed)';
  const quoteEdges = new RegExp('^[' + DQ + SQ + ']|[' + DQ + SQ + ']$', 'g');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const nameM = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(line);
    const nameCap = nameM?.[1];
    if (nameCap !== undefined) {
      lastName = nameCap.replace(quoteEdges, '');
      continue;
    }
    const runM = /^(\s*)run:\s*[|>][+-]?\s*$/.exec(line);
    const runIndent = runM?.[1];
    if (runIndent === undefined) continue;
    const keyIndent = runIndent.length;
    const body: string[] = [];
    let j = i + 1;
    let bodyIndent = -1;
    for (; j < lines.length; j++) {
      const bl = lines[j] ?? '';
      if (bl.trim() === '') {
        body.push('');
        continue;
      }
      const indent = bl.length - bl.trimStart().length;
      if (indent <= keyIndent) break;
      if (bodyIndent === -1) bodyIndent = indent;
      body.push(bl.slice(bodyIndent));
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    blocks.push({ step: lastName, script: body.join(NL) });
    i = j - 1;
  }
  return blocks;
}

const files = readdirSync(WF_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => join(WF_DIR, f));

describe('CI workflow inline shell is valid POSIX sh', () => {
  it('finds at least one workflow run block', () => {
    const total = files.flatMap((f) => extractRunBlocks(readFileSync(f, 'utf8')));
    expect(total.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(REPO_ROOT.length + 1);
    for (const { step, script } of extractRunBlocks(readFileSync(file, 'utf8'))) {
      it(rel + ' :: ' + step + ' :: no literal backslash escapes', () => {
        const leakedEscapes = BAD_ESCAPES.filter((e) => script.includes(e));
        expect({ step, leakedEscapes }).toEqual({ step, leakedEscapes: [] });
      });
      it(rel + ' :: ' + step + ' :: parses under sh -n', () => {
        const res = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' });
        const stderr = res.stderr.trim();
        expect({ step, exitCode: res.status, stderr }).toEqual({ step, exitCode: 0, stderr: '' });
      });
    }
  }
});

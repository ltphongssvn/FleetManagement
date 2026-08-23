// scripts/terminal-refspec-wiring.guard.test.ts
// refs/terminals/* is the authoritative terminal registry, and it is NOT in
// git's default fetch refspec. Two consequences, both observed:
//
// 1. `git fetch origin --prune` deletes every refs/remotes/origin/terminals/*
//    mirror, because under the default refspec they have no upstream
//    counterpart and prune reads them as orphaned. Seen 2026-08-16 (t123,
//    wiped 89-122) and again 2026-08-19 (wiped 89-137). The remote is
//    untouched, but a local read then sees an EMPTY registry -- which is
//    indistinguishable from "nothing claimed" and would re-issue a burned
//    terminal number across two machines.
// 2. sync-worktrees.ts:315 repairs the mirror with an explicit refspec fetch.
//    Nothing asserted that line existed, so deleting it would silently
//    reintroduce the failure -- and the 2026-08-16 finding was logged as
//    "noted as a doctor check" that was never built, which is why it recurred
//    three days later.
//
// This guard is that check. sync:worktrees is the only sanctioned fetch path.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callHasOption } from './source-facts.js';

const SYNC_PATH = join(import.meta.dirname, 'sync-worktrees.ts');
const SYNC = readFileSync(SYNC_PATH, 'utf8');

describe('terminal registry refspec wiring', () => {
  it('sync-worktrees fetches refs/terminals/* explicitly', () => {
    expect(SYNC).toMatch(/\+refs\/terminals\/\*:refs\/remotes\/origin\/terminals\/\*/);
  });

  // ASSERTED STRUCTURALLY (2026-08-23). This case used to find the single line
  // containing the refspec and require /allowFail:\s*true/ ON THAT SAME LINE.
  // That encodes Prettier's line-breaking, not the wiring: the call is 89
  // characters with the refspec alone, so formatting to printWidth 100 moved
  // allowFail onto its own line and the guard failed while the contract was
  // intact. Widening the regex across lines only moves the fragility -- the
  // claim is "this call passes this option", which the call graph answers and a
  // line-oriented search cannot.
  it('tolerates a remote without the namespace rather than breaking the sync', () => {
    expect(callHasOption(SYNC_PATH, 'git', 'refs/terminals/*:refs', 'allowFail')).toBe(true);
  });

  it('explains why the default refspec is insufficient', () => {
    expect(SYNC).toMatch(/NOT in the default fetch refspec/i);
  });

  it('reports an unfetched registry rather than answering with an empty one', () => {
    const registry = readFileSync(join(import.meta.dirname, 'terminal-registry.ts'), 'utf8');
    expect(registry).toMatch(/not fetched/);
  });
});

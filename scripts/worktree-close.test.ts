// scripts/worktree-close.test.ts
// RED-first (worktree-close arc slice 2, 2026-07-15): pure state-gathering
// parsers that feed the slice-1 decision core (scripts/close-worktree.ts).
// Precedent: sync-worktrees.ts is untested because git I/O and parsing are
// fused in one impure main(). This slice keeps every parser pure and tested;
// only the thin driver touches execFileSync, mirroring compose-identity.ts.
// Contract:
//  - parseWorktreePorcelain(stdout): entries {path, branch|null}; git lists
//    the primary clone FIRST, so index 0 identifies it. detached -> null.
//  - parseAheadBehind(stdout): rev-list --left-right --count HEAD...@{u}.
//  - countDirtyFiles(stdout): status --porcelain=v1 -uall line count.
//  - resolveCloseInput(params): assembles + Zod-parses a WorktreeCloseInput.
//
// PARSED ONCE, BOUND AND GUARDED (2026-08-08). The porcelain cases indexed the
// parse result directly ([0].path, [2].branch), which is TS2532 under
// noUncheckedIndexedAccess. Optional chaining was rejected: the entry-count
// assertion is this suite's premise, so a parser regression that drops an entry
// must fail by name, not as "expected undefined to be ...". Binding the result
// once also removes four redundant re-parses of the same fixture.

import { describe, it, expect } from 'vitest';
import {
  parseWorktreePorcelain,
  parseAheadBehind,
  countDirtyFiles,
  resolveCloseInput,
} from './worktree-close.js';

const NL = String.fromCharCode(10);

const porcelain = [
  'worktree /home/u/code/FleetManagement',
  'HEAD aaaa111',
  'branch refs/heads/main',
  '',
  'worktree /home/u/code/t16-wt1',
  'HEAD bbbb222',
  'branch refs/heads/feature/order-status-groups',
  '',
  'worktree /home/u/code/detached-wt',
  'HEAD cccc333',
  'detached',
  '',
].join(NL);

describe('worktree-close: porcelain parsing', () => {
  const entries = parseWorktreePorcelain(porcelain);

  it('parses every worktree entry', () => {
    expect(entries.length).toBe(3);
  });
  it('strips the refs/heads/ prefix', () => {
    expect(entries[1]).toEqual({
      path: '/home/u/code/t16-wt1',
      branch: 'feature/order-status-groups',
    });
  });
  it('lists the primary clone first', () => {
    const [primary] = entries;
    expect(primary, 'porcelain parse yielded no first entry').toBeDefined();
    if (primary === undefined) return;
    expect(primary.path).toBe('/home/u/code/FleetManagement');
  });
  it('reports a detached worktree as a null branch', () => {
    const detached = entries[2];
    expect(detached, 'porcelain parse yielded no third entry').toBeDefined();
    if (detached === undefined) return;
    expect(detached.branch).toBe(null);
  });
  it('returns an empty list for empty stdout', () => {
    expect(parseWorktreePorcelain('')).toEqual([]);
  });
});

describe('worktree-close: ahead/behind parsing', () => {
  it('reads tab-separated left-right counts', () => {
    expect(parseAheadBehind('19' + String.fromCharCode(9) + '0')).toEqual({ ahead: 19, behind: 0 });
  });
  it('reads space-separated counts', () => {
    expect(parseAheadBehind('0 15')).toEqual({ ahead: 0, behind: 15 });
  });
  it('reads a fully synced pair', () => {
    expect(parseAheadBehind('0' + String.fromCharCode(9) + '0')).toEqual({ ahead: 0, behind: 0 });
  });
  it('throws on unparseable output rather than guessing zero', () => {
    expect(() => parseAheadBehind('')).toThrow();
    expect(() => parseAheadBehind('nope')).toThrow();
  });
});

describe('worktree-close: dirty counting', () => {
  it('counts nothing for a clean tree', () => {
    expect(countDirtyFiles('')).toBe(0);
    expect(countDirtyFiles(NL)).toBe(0);
  });
  it('counts modified and untracked lines', () => {
    const out = [' M scripts/a.ts', '?? scratch.txt', 'A  scripts/b.ts'].join(NL);
    expect(countDirtyFiles(out)).toBe(3);
  });
  it('ignores the --branch header line', () => {
    const out = ['## feature/x...origin/feature/x', ' M scripts/a.ts'].join(NL);
    expect(countDirtyFiles(out)).toBe(1);
  });
});

describe('worktree-close: input assembly is Zod-parsed', () => {
  const base = {
    path: '/home/u/code/t16-wt1',
    branch: 'feature/order-status-groups',
    primaryPath: '/home/u/code/FleetManagement',
    upstream: 'origin/feature/order-status-groups',
    ahead: 0,
    dirtyFileCount: 0,
    containedInIntegration: true,
  };
  it('assembles a clean removable input', () => {
    expect(resolveCloseInput(base)).toEqual({
      path: '/home/u/code/t16-wt1',
      branch: 'feature/order-status-groups',
      hasUpstream: true,
      aheadOfRemote: 0,
      dirtyFileCount: 0,
      containedInIntegration: true,
      isPrimaryClone: false,
      // retired defaults false at assembly (F4): the Zod default is
      // materialised here, never left undefined for the decision core.
      retired: false,
      // done defaults false the same way: the recency waiver is opt-in, so an
      // assembly that never mentions it must protect, never permit.
      done: false,
      // idleHours defaults 0 (recent) at assembly: the fail-safe schema default
      // is materialised here since base supplies no reflog-derived value.
      idleHours: 0,
    });
  });
  it('flags the primary clone by path identity', () => {
    const v = resolveCloseInput({ ...base, path: base.primaryPath, branch: 'main' });
    expect(v.isPrimaryClone).toBe(true);
  });
  it('an empty upstream means no upstream', () => {
    expect(resolveCloseInput({ ...base, upstream: '' }).hasUpstream).toBe(false);
  });
  it('rejects a detached worktree: there is no branch to close', () => {
    expect(() => resolveCloseInput({ ...base, branch: null })).toThrow();
  });
  it('propagates the Zod boundary error on a negative count', () => {
    expect(() => resolveCloseInput({ ...base, ahead: -1 })).toThrow();
  });
});

// scripts/worktree-close-cli.test.ts
// Outside-in RED (worktree-close arc slice 3, 2026-07-15): contract for the
// CLI layer BEFORE it exists. Slice 1 (#328) owns the verdict, slice 2 (#330)
// owns the parsers; this slice owns the git argv the driver runs, target
// selection, and the operator report. Pure planners describe WHAT to run; the
// side-effecting main() is entrypoint-only and never imported here.
// Precedent: scripts/e2e/stack-e2e-isolated.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listWorktreesArgs,
  upstreamArgs,
  aheadBehindArgs,
  dirtyArgs,
  containmentArgs,
  selectTarget,
  formatCloseReport,
} from './worktree-close-cli.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  { path: '/home/u/code/FleetManagement', branch: 'main' },
  { path: '/home/u/code/t16-wt1-order-status-groups', branch: 'feature/order-status-groups' },
  { path: '/home/u/code/detached', branch: null },
];

describe('worktree-close-cli: git argv is planned, not string-built', () => {
  it('lists worktrees in porcelain form', () => {
    expect(listWorktreesArgs()).toEqual(['worktree', 'list', '--porcelain']);
  });
  it('resolves the upstream symbolic name', () => {
    expect(upstreamArgs()).toEqual([
      'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}',
    ]);
  });
  it('counts ahead/behind against the resolved upstream', () => {
    expect(aheadBehindArgs('origin/feature/x')).toEqual([
      'rev-list', '--left-right', '--count', 'HEAD...origin/feature/x',
    ]);
  });
  it('reports dirty files including every untracked one', () => {
    expect(dirtyArgs()).toEqual([
      'status', '--porcelain=v1', '--untracked-files=all',
    ]);
  });
  it('tests containment as set subtraction against the integration ref', () => {
    expect(containmentArgs('origin/develop')).toEqual([
      'rev-list', '--count', 'origin/develop..HEAD',
    ]);
  });
  it('never plans a destructive git flag', () => {
    const flat = [
      listWorktreesArgs(), upstreamArgs(), aheadBehindArgs('origin/x'),
      dirtyArgs(), containmentArgs('origin/develop'),
    ].flat();
    for (const bad of ['--force', '-f', '-D', 'reset', 'clean', 'push']) {
      expect(flat.includes(bad)).toBe(false);
    }
  });
});

describe('worktree-close-cli: target selection', () => {
  it('finds a worktree by exact path', () => {
    expect(selectTarget(entries, '/home/u/code/t16-wt1-order-status-groups').branch)
      .toBe('feature/order-status-groups');
  });
  it('throws on an unknown path rather than closing the wrong tree', () => {
    expect(() => selectTarget(entries, '/home/u/code/nope')).toThrow();
  });
  it('throws on a path that is not a worktree root', () => {
    expect(() => selectTarget(entries, '/home/u/code/t16-wt1-order-status-groups/scripts')).toThrow();
  });
});

describe('worktree-close-cli: operator report', () => {
  const input = {
    path: '/home/u/code/t16-wt1-order-status-groups',
    branch: 'feature/order-status-groups',
    hasUpstream: true,
    aheadOfRemote: 0,
    dirtyFileCount: 0,
    containedInIntegration: true,
    isPrimaryClone: false,
  };
  it('names the branch and the verdict on a remove', () => {
    const out = formatCloseReport({ action: 'remove', reasons: [] }, input);
    expect(out).toContain('feature/order-status-groups');
    expect(out).toContain('remove');
  });
  it('lists every refusal reason, not just the first', () => {
    const out = formatCloseReport(
      { action: 'refuse', reasons: ['unpushed', 'dirty'] },
      { ...input, aheadOfRemote: 3, dirtyFileCount: 2 },
    );
    expect(out).toContain('unpushed');
    expect(out).toContain('dirty');
  });
  it('is plain text with no ANSI escapes when reasons are empty', () => {
    const out = formatCloseReport({ action: 'remove', reasons: [] }, input);
    expect(out.includes(String.fromCharCode(27))).toBe(false);
  });
});

describe('worktree-close-cli: the op is registered, not ad hoc', () => {
  it('turbo.jsonc registers a root-scoped worktree:close task', () => {
    const turbo = readFileSync(join(repoRoot, 'turbo.jsonc'), 'utf-8');
    expect(turbo).toContain('//#worktree:close');
  });
  it('the task is cache:false (side-effecting git mutation)', () => {
    const turbo = readFileSync(join(repoRoot, 'turbo.jsonc'), 'utf-8');
    const idx = turbo.indexOf('//#worktree:close');
    const block = turbo.slice(idx, idx + 1200);
    expect(block).toContain('cache');
    expect(block).toContain('false');
  });
  it('package.json exposes the committed script the task runs', () => {
    const pkg = readFileSync(join(repoRoot, 'package.json'), 'utf-8');
    expect(pkg).toContain('worktree:close');
    expect(pkg).toContain('scripts/worktree-close-cli.ts');
  });
});

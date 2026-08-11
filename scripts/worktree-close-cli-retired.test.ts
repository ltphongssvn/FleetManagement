// scripts/worktree-close-cli-retired.test.ts
// RED (F4 slice 2): the decision core can express a retired close, but the CLI
// cannot REACH it -- main() never sets retired, so the new path is unreachable
// from the registered task. Wiring is the point: a feature no entrypoint can
// invoke is dead code (the lesson from the co-so-du-lieu arc).
//
// Contract pinned here:
//  * argv parsing is a PURE function, so flag handling is tested without
//    spawning git (the slice-3 precedent: pure planners tested, main() ignored);
//  * --retired is opt-in and order-independent relative to the path;
//  * absent flag means retired=false, so every existing invocation is unchanged;
//  * the path is still required, and --retired alone is not a path;
//  * resolveCloseInput threads retired through to the Zod boundary;
//  * the operator report shows retired in the state line, so a permitted close
//    visibly states WHY it was allowed.
// NOTE (2026-07-28): BASE is a ResolveCloseInputParams literal (driver-input
// shape, distinct from the schema WorktreeCloseInput). idleHours: 999 keeps it
// past the recency threshold so the retired-dimension assertions are not masked
// by the recency guard. This shape appears in only two files, so an inline
// baseline is proportionate -- the makeCloseInput factory covers the schema
// output shape where duplication actually proliferated.
import { describe, it, expect } from 'vitest';
import { parseCloseArgv, formatCloseReport } from './worktree-close-cli.js';
import { resolveCloseInput } from './worktree-close.js';
import { decideClose } from './close-worktree.js';
const BASE = {
  path: '/home/u/code/t4-wt6',
  branch: 'feature/co-so-du-lieu',
  primaryPath: '/home/u/code/FleetManagement',
  upstream: 'origin/feature/co-so-du-lieu',
  ahead: 0,
  dirtyFileCount: 0,
  containedInIntegration: false,
  idleHours: 999,
};
describe('parseCloseArgv: pure flag parsing', () => {
  it('reads the path with no flags and defaults retired to false', () => {
    expect(parseCloseArgv(['/home/u/code/t4-wt6'])).toEqual({
      path: '/home/u/code/t4-wt6',
      retired: false,
      done: false,
    });
  });
  it('reads --retired after the path', () => {
    expect(parseCloseArgv(['/home/u/code/t4-wt6', '--retired'])).toEqual({
      path: '/home/u/code/t4-wt6',
      retired: true,
      done: false,
    });
  });
  it('reads --retired before the path (order independent)', () => {
    expect(parseCloseArgv(['--retired', '/home/u/code/t4-wt6'])).toEqual({
      path: '/home/u/code/t4-wt6',
      retired: true,
      done: false,
    });
  });
  it('returns a null path when only the flag is given', () => {
    expect(parseCloseArgv(['--retired']).path).toBe(null);
  });
  it('returns a null path for empty argv', () => {
    expect(parseCloseArgv([])).toEqual({ path: null, retired: false, done: false });
  });
  it('ignores an unknown flag rather than treating it as the path', () => {
    expect(parseCloseArgv(['--wat', '/p']).path).toBe('/p');
  });
});
describe('resolveCloseInput threads retired to the boundary', () => {
  it('defaults retired false when the param is absent', () => {
    expect(resolveCloseInput(BASE).retired).toBe(false);
  });
  it('carries retired true through the Zod parse', () => {
    expect(resolveCloseInput({ ...BASE, retired: true }).retired).toBe(true);
  });
  it('a retired resolve then decides remove-keep-branch', () => {
    const input = resolveCloseInput({ ...BASE, retired: true });
    expect(decideClose(input).action).toBe('remove-keep-branch');
  });
});
describe('formatCloseReport surfaces retired', () => {
  it('shows retired=true in the state line of a permitted retired close', () => {
    const input = resolveCloseInput({ ...BASE, retired: true });
    const report = formatCloseReport(decideClose(input), input);
    expect(report).toContain('remove-keep-branch');
    expect(report).toContain('retired=true');
  });
  it('shows retired=false for a normal refusal', () => {
    const input = resolveCloseInput(BASE);
    const report = formatCloseReport(decideClose(input), input);
    expect(report).toContain('unmerged');
    expect(report).toContain('retired=false');
  });
});

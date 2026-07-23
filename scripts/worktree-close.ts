// scripts/worktree-close.ts
// GREEN (worktree-close arc slice 2, 2026-07-15): pure state-gathering parsers
// feeding the slice-1 decision core (scripts/close-worktree.ts).
// Why pure: sync-worktrees.ts fuses git I/O with parsing in one impure main(),
// which is exactly why it has no tests. Here every parser is a pure function of
// stdout; only the thin driver (separate slice) touches execFileSync.

import {
  WorktreeCloseInputSchema,
  type WorktreeCloseInput,
} from './close-worktree.js';

const NL = String.fromCharCode(10);
const WORKTREE_PREFIX = 'worktree ';
const BRANCH_PREFIX = 'branch ';
const HEADS_PREFIX = 'refs/heads/';

export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

export function parseWorktreePorcelain(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const flush = (): void => {
    if (path !== null) entries.push({ path, branch });
    path = null;
    branch = null;
  };
  for (const line of stdout.split(NL)) {
    if (line.startsWith(WORKTREE_PREFIX)) {
      flush();
      path = line.slice(WORKTREE_PREFIX.length);
    } else if (line.startsWith(BRANCH_PREFIX)) {
      branch = line.slice(BRANCH_PREFIX.length).replace(HEADS_PREFIX, '');
    } else if (line === 'detached') {
      branch = null;
    }
  }
  flush();
  return entries;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export function parseAheadBehind(stdout: string): AheadBehind {
  const parts = stdout.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length !== 2) {
    throw new Error('unparseable rev-list --left-right --count output: ' + JSON.stringify(stdout));
  }
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  if (Number.isInteger(ahead) === false || Number.isInteger(behind) === false) {
    throw new Error('non-integer ahead/behind counts: ' + JSON.stringify(stdout));
  }
  return { ahead, behind };
}

export function countDirtyFiles(stdout: string): number {
  return stdout
    .split(NL)
    .filter((line) => line.length > 0)
    .filter((line) => line.startsWith('## ') === false).length;
}

export interface ResolveCloseInputParams {
  path: string;
  branch: string | null;
  primaryPath: string;
  upstream: string;
  ahead: number;
  dirtyFileCount: number;
  containedInIntegration: boolean;
  // F4: opt-in retirement. Absent means false via the schema default, so
  // every existing caller is unchanged.
  retired?: boolean;
}

export function resolveCloseInput(params: ResolveCloseInputParams): WorktreeCloseInput {
  if (params.branch === null) {
    throw new Error('detached worktree has no branch to close: ' + params.path);
  }
  return WorktreeCloseInputSchema.parse({
    path: params.path,
    branch: params.branch,
    hasUpstream: params.upstream.length > 0,
    aheadOfRemote: params.ahead,
    dirtyFileCount: params.dirtyFileCount,
    containedInIntegration: params.containedInIntegration,
    isPrimaryClone: params.path === params.primaryPath,
    retired: params.retired ?? false,
  });
}

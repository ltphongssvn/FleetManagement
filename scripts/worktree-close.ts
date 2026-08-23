// scripts/worktree-close.ts
// GREEN (worktree-close arc slice 2, 2026-07-15): pure state-gathering parsers
// feeding the slice-1 decision core (scripts/close-worktree.ts).
// Why pure: sync-worktrees.ts fuses git I/O with parsing in one impure main(),
// which is exactly why it has no tests. Here every parser is a pure function of
// stdout; only the thin driver (separate slice) touches execFileSync.

import { WorktreeCloseInputSchema, type WorktreeCloseInput } from './close-worktree.js';

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
  const parts = stdout
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length !== 2) {
    throw new Error('unparseable rev-list --left-right --count output: ' + JSON.stringify(stdout));
  }
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    throw new Error('non-integer ahead/behind counts: ' + JSON.stringify(stdout));
  }
  return { ahead, behind };
}

export function countDirtyFiles(stdout: string): number {
  return stdout
    .split(NL)
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('## ')).length;
}

// Parse the epoch of the most recent per-worktree HEAD reflog entry into hours
// idle. git reflog --date=unix -1 prints e.g. HEAD@{1785247943}: ...; pull the
// braced epoch and diff against now (injected, so this stays pure and testable).
// No reflog (empty stdout / no braced epoch) means UNKNOWN -> return 0 (recent),
// so the fail-safe default protects rather than deletes.
export function parseReflogIdleHours(stdout: string, nowEpochSeconds: number): number {
  const open = String.fromCharCode(123);
  const close = String.fromCharCode(125);
  const start = stdout.indexOf(open);
  const end = stdout.indexOf(close, start + 1);
  if (start === -1 || end === -1) return 0;
  const inner = stdout.slice(start + 1, end);
  if (!/^[0-9]+$/.test(inner)) return 0;
  const last = Number(inner);
  if (!Number.isFinite(last)) return 0;
  const seconds = nowEpochSeconds - last;
  if (seconds < 0) return 0;
  return seconds / 3600;
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
  // DONE: operator declaration that the session is finished. Optional, so
  // every existing caller is unchanged; the schema default (false) owns the
  // fallback, exactly as retired and idleHours do.
  done?: boolean;
  // Recency (2026-07-28): hours since the last per-worktree HEAD reflog entry.
  // Passed THROUGH untouched: the schema .default(0) is the single source of the
  // fail-safe default (0 = recent = protected), so this layer never re-defaults
  // (SSOT: one place owns the fallback). undefined here triggers that schema
  // default; drivers always compute and pass the real value.
  idleHours?: number;
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
    done: params.done ?? false,
    // Pass-through: schema .default(0) owns the fallback (no re-default here).
    idleHours: params.idleHours,
  });
}

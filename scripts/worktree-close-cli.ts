// scripts/worktree-close-cli.ts
// GREEN (worktree-close arc slice 3, 2026-07-15): git argv planners, target
// selection, operator report, and the side-effecting driver for worktree:close.
// Slice 1 (close-worktree.ts) owns the verdict; slice 2 (worktree-close.ts)
// owns the parsers; this composes them into one registered, rediscoverable op.
// Pure planners are unit-tested; main() runs ONLY as entrypoint so the contract
// test imports the pure parts without spawning git.
// Precedent: scripts/e2e/stack-e2e-isolated.ts.
//
// RECENCY (2026-07-28): the driver now also gathers the per-worktree HEAD reflog
// (reflogArgs) and derives idleHours via parseReflogIdleHours, so decideClose can
// refuse an actively-developed worktree even when merged and clean.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { decideClose, closePlan, type CloseVerdict, type WorktreeCloseInput } from './close-worktree.js';
import {
  parseWorktreePorcelain,
  parseAheadBehind,
  countDirtyFiles,
  parseReflogIdleHours,
  resolveCloseInput,
  type WorktreeEntry,
} from './worktree-close.js';

const NL = String.fromCharCode(10);
const INTEGRATION_REF = 'origin/develop';

// ---- pure argv planners ----

export function listWorktreesArgs(): string[] {
  return ['worktree', 'list', '--porcelain'];
}

export function upstreamArgs(): string[] {
  return ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'];
}

export function aheadBehindArgs(upstream: string): string[] {
  return ['rev-list', '--left-right', '--count', 'HEAD...' + upstream];
}

export function dirtyArgs(): string[] {
  return ['status', '--porcelain=v1', '--untracked-files=all'];
}

export function containmentArgs(integrationRef: string): string[] {
  return ['rev-list', '--count', integrationRef + '..HEAD'];
}

// Most-recent per-worktree HEAD reflog entry with a unix-epoch date, so the
// driver can derive idle hours (liveness). -1 = only the newest entry.
export function reflogArgs(): string[] {
  return ['reflog', '--date=unix', '-1'];
}

// ---- pure argv parsing ----

export interface CloseArgv {
  path: string | null;
  retired: boolean;
}

// Pure so flag handling is unit-tested without spawning git. --retired is
// opt-in and order-independent; anything else starting with -- is ignored
// rather than mistaken for the path.
export function parseCloseArgv(argv: readonly string[]): CloseArgv {
  let path: string | null = null;
  let retired = false;
  for (const arg of argv) {
    if (arg === '--retired') {
      retired = true;
    } else if (!arg.startsWith('--') && path === null && arg.length > 0) {
      path = arg;
    }
  }
  return { path, retired };
}

// ---- pure selection + report ----

// Matches by RESOLVED path, never by string equality. The old comparison
// refused `../t89-wt1-turbo` -- a path that resolves to a real worktree root --
// and then printed the absolute paths it wanted, so the operator re-ran the
// same command with a different spelling of the same directory. `../name` is
// what tab-completion produces from the canonical root, so requiring the
// absolute form is a papercut with a loss-risk edge: an operator who assumes
// the relative path worked may believe a worktree was closed when the command
// exited 1.
//
// cwd is a PARAMETER, defaulted, not read from process inside: resolve() is
// pure given a cwd, so the function stays unit-testable with no filesystem and
// no cwd juggling in tests. Trailing separators and '.' segments normalise
// away for free, which is why those cases are covered too.
//
// Resolution is not a wildcard -- an unknown path still throws, and the message
// still lists the known roots.
export function selectTarget(
  entries: readonly WorktreeEntry[],
  path: string,
  cwd: string = process.cwd(),
): WorktreeEntry {
  const want = resolve(cwd, path);
  const hit = entries.find((e) => resolve(e.path) === want);
  if (hit === undefined) {
    throw new Error('not a worktree root: ' + path + NL + 'known roots:' + NL +
      entries.map((e) => '  ' + e.path).join(NL));
  }
  return hit;
}

export function formatCloseReport(verdict: CloseVerdict, input: WorktreeCloseInput): string {
  const lines = [
    'worktree: ' + input.path,
    'branch:   ' + input.branch,
    'verdict:  ' + verdict.action,
  ];
  if (verdict.action === 'refuse') {
    lines.push('refused because:');
    for (const r of verdict.reasons) lines.push('  - ' + r);
  }
  // State is printed for EVERY verdict, not just refusals: a permitted
  // retired close must visibly state why it was allowed (retired=true with
  // contained=false), so the operator can audit the decision. idleH is floored
  // to whole hours for a readable state line.
  lines.push('state: ahead=' + String(input.aheadOfRemote) +
    ' dirty=' + String(input.dirtyFileCount) +
    ' upstream=' + String(input.hasUpstream) +
    ' contained=' + String(input.containedInIntegration) +
    ' retired=' + String(input.retired) +
    ' idleH=' + String(Math.floor(input.idleHours)));
  return lines.join(NL);
}

/* v8 ignore start -- side-effecting entrypoint; pure planners above are unit-tested */
function git(args: readonly string[], cwd?: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

function gitAllowFail(args: readonly string[], cwd?: string): string {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

function mainWorktreeClose(): number {
  const argv = parseCloseArgv(process.argv.slice(2));
  const target = argv.path;
  if (target === null) {
    process.stderr.write('usage: turbo run worktree:close -- <worktree-path> [--retired]' + NL);
    return 2;
  }
  const entries = parseWorktreePorcelain(git(listWorktreesArgs()));
  const entry = selectTarget(entries, target);
  const upstream = gitAllowFail(upstreamArgs(), entry.path);
  const ahead = upstream.length > 0
    ? parseAheadBehind(git(aheadBehindArgs(upstream), entry.path)).ahead
    : 0;
  const idleHours = parseReflogIdleHours(
    gitAllowFail(reflogArgs(), entry.path),
    Math.floor(Date.now() / 1000),
  );
  const input = resolveCloseInput({
    path: entry.path,
    branch: entry.branch,
    primaryPath: entries[0]?.path ?? '',
    upstream,
    ahead,
    dirtyFileCount: countDirtyFiles(git(dirtyArgs(), entry.path)),
    containedInIntegration: Number(git(containmentArgs(INTEGRATION_REF), entry.path)) === 0,
    retired: argv.retired,
    idleHours,
  });
  const verdict = decideClose(input);
  process.stdout.write(formatCloseReport(verdict, input) + NL);
  if (verdict.action === 'refuse') return 1;
  for (const cmd of closePlan(verdict, input)) {
    process.stderr.write('[worktree:close] ' + cmd.join(' ') + NL);
    git(cmd.slice(1));
  }
  return 0;
}

const isMain = process.argv[1]?.endsWith('worktree-close-cli.ts') ?? false;
if (isMain) {
  process.exit(mainWorktreeClose());
}
/* v8 ignore stop */

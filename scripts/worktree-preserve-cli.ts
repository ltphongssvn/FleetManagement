// scripts/worktree-preserve-cli.ts
// GREEN (t85 worktree-preserve arc, 2026-08-05): the //#worktree:preserve
// driver. Argv in, git in, process.exit out. Every decision belongs to a
// tested module; what lives here is wiring too small to hide a defect.
//
// COMPOSITION, all imported and none reimplemented:
//   listing   parseWorktreePorcelain + listWorktreesArgs (worktree-close*)
//   parsing   parseDirtyEntries (worktree-preserve.ts)
//   decision  classifyPreservation + verifyPreservation (worktree-preserve.ts)
//   sweep     runPreserve (worktree-preserve-runner.ts, injected port)
//   verdict   preserveExitCode + PRESERVE_EXIT
//
// FACTORIES, NOT MODULE SINGLETONS. makeGitRunner and makeWritePort are called
// ONCE, in mainPreserve, which is the composition root. That is the 2026
// idiom -- a factory at the composition root for anything tests need to fake,
// which is dependency injection without a framework. Deliberately NO container
// (tsyringe, InversifyJS): manual wiring is the right scale for four port
// methods, and over-applying DI to simple components buys complexity without
// benefit. The failure this avoids is concrete: with a module-level port, some
// modules end up unit-testable and others lack any entry point for testing, so
// exercising simple logic needs elaborate scaffolding.
//
// NO MACHINE-SPECIFIC PATHS. Every git call is scoped by a worktree path that
// came from git worktree list --porcelain, never an absolute path rooted at a
// developer home directory. That is what makes this runnable unchanged in CI.
//
// ARGV IS ZOD-PARSED AT THE PROCESS BOUNDARY. process.argv is genuinely
// external input -- Axis 1 of the two-axis rule: validate at trust boundaries,
// never re-validate trusted internal data. parseArgs gives structure; the
// schema gives a guarantee; PreserveArgv derives via z.infer so the shape has
// exactly one definition.
//
// EVERY GIT CALL SITS INSIDE A BOUNDARY. The runner isolates per-target
// failures, but listing worktrees and reading their status happen BEFORE the
// sweep. Without a boundary here a git failure there would still crash with a
// stack trace instead of resolving to a graded exit -- the same defect the
// runner was just fixed for, one level up.
//
// THE COUNT IS READ FROM GIT, NOT ASSUMED. countCommittedFiles asks git how
// many files the commit actually contains. That is the entire point of the
// arc: the earlier stash-based attempt believed its own success message while
// dropping untracked files, 1 of 3 and then 2 of 4.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { listWorktreesArgs } from './worktree-close-cli.js';
import { parseWorktreePorcelain } from './worktree-close.js';
import { parseDirtyEntries, PRESERVE_EXIT } from './worktree-preserve.js';
import {
  runPreserve,
  type PreserveTarget,
  type WorktreeWritePort,
} from './worktree-preserve-runner.js';
const NL = String.fromCharCode(10);
const GIT_TIMEOUT_MS = 60_000;
const GIT_PUSH_TIMEOUT_MS = 180_000;
const USAGE = 'usage: turbo run worktree:preserve -- [<worktree-path>] [--execute]';
// ---- pure argv parsing, validated at the trust boundary ----
export const PreserveArgvSchema = z.object({
  execute: z.boolean(),
  only: z.string().min(1).nullable(),
});
export type PreserveArgv = z.infer<typeof PreserveArgvSchema>;
export function parsePreserveArgv(argv: readonly string[]): PreserveArgv {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { execute: { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true,
  });
  return PreserveArgvSchema.parse({
    execute: values.execute,
    only: positionals[0] ?? null,
  });
}
// ---- pure target assembly ----
// The dirty reader is a PARAMETER so selection is testable without touching a
// real repository, and so a filtered run provably reads only its one target.
export type DirtyReader = (path: string) => string;
export function buildPreserveTargets(
  entries: readonly { path: string; branch: string | null }[],
  only: string | null,
  readDirty: DirtyReader,
): PreserveTarget[] {
  const selected = only === null ? entries : entries.filter((e) => e.path === only);
  if (only !== null && selected.length === 0) {
    throw new Error(
      'not a worktree root: ' + only + NL + 'known roots:' + NL +
        entries.map((e) => '  ' + e.path).join(NL),
    );
  }
  return selected.map((e) => ({
    path: e.path,
    branch: e.branch,
    entries: parseDirtyEntries(readDirty(e.path)),
  }));
}
// ---- constructible git surface ----
export type GitRunner = (args: readonly string[], cwd?: string, timeoutMs?: number) => string;
export function makeGitRunner(): GitRunner {
  return (args, cwd, timeoutMs) =>
    execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs ?? GIT_TIMEOUT_MS,
    }).trim();
}
// Takes the runner as a parameter, so the port's argv contracts can be
// asserted against a stub without spawning git.
export function makeWritePort(git: GitRunner): WorktreeWritePort {
  return {
    stageAll: (path) => {
      git(['add', '-A'], path);
    },
    // --no-verify is deliberate and narrow: a WIP preservation commit CANNOT
    // pass lint or typecheck by definition -- that is precisely why it was
    // never committed in the first place -- and refusing to preserve
    // twenty-five-day-old work because it does not lint would invert the
    // tool's purpose. The commit is marked wip: and says in its own body that
    // it is not an integration candidate.
    commit: (path, message) => {
      git(['commit', '--no-verify', '-m', message], path);
    },
    // Asks GIT for the count. Never inferred, never trusted from our own plan.
    countCommittedFiles: (path) => {
      const out = git(['show', '--stat', '--name-only', '--format=', 'HEAD'], path);
      return out.split(NL).filter((l) => l.trim().length > 0).length;
    },
    // Also --no-verify: the pre-push hook runs the full gate, which a WIP
    // commit cannot pass. Reached ONLY after the count gate verified.
    pushBranch: (path, branch) => {
      git(['push', '--no-verify', '-u', 'origin', branch], path, GIT_PUSH_TIMEOUT_MS);
    },
  };
}
export function statusArgs(): readonly string[] {
  return ['status', '--porcelain=v1', '--untracked-files=all'];
}
/* v8 ignore start -- side-effecting entrypoint; pure parts above are unit-tested */
function reasonFrom(err: unknown): string {
  return err instanceof Error ? (err.message.split(NL)[0] ?? err.message) : String(err);
}
function mainPreserve(): number {
  let argv: PreserveArgv;
  try {
    argv = parsePreserveArgv(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(reasonFrom(err) + NL + USAGE + NL);
    return PRESERVE_EXIT.usage;
  }
  // COMPOSITION ROOT: constructed once, flows downward.
  const git = makeGitRunner();
  let targets: PreserveTarget[];
  try {
    const entries = parseWorktreePorcelain(git(listWorktreesArgs()));
    targets = buildPreserveTargets(entries, argv.only, (path) => git(statusArgs(), path));
  } catch (err) {
    process.stderr.write(reasonFrom(err) + NL);
    return PRESERVE_EXIT.usage;
  }
  const report = runPreserve(targets, makeWritePort(git), { execute: argv.execute });
  for (const line of report.lines) process.stdout.write(line + NL);
  const s = report.summary;
  process.stdout.write(
    NL + 'Summary: ' + String(s.preserved) + ' preserved, ' + String(s.refused) + ' refused, ' +
      String(s.failed) + ' failed, ' + String(s.shortfall) + ' shortfall, ' +
      String(s.skipped) + ' skipped' +
      (argv.execute ? '' : '  [DRY RUN -- pass --execute to apply]') + NL,
  );
  return report.exitCode;
}
const isMain = process.argv[1]?.endsWith('worktree-preserve-cli.ts') ?? false;
if (isMain) {
  process.exit(mainPreserve());
}
/* v8 ignore stop */

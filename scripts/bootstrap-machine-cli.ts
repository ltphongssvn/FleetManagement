// scripts/bootstrap-machine-cli.ts
// IMPERATIVE SHELL for the machine bootstrap. Orchestration only: every rule
// lives in bootstrap-machine.ts (pure), which is why this file spawns processes
// and reads directories but decides nothing inline.
//
// INVARIANTS, each closing a specific failure:
//   1. NEVER exits non-zero from the prepare path. This runs on every
//      "pnpm install", including all eight CI workflows, none of which pass
//      --ignore-scripts. A hard failure here would redden every pipeline to
//      enforce a workstation concern. Invoked directly (bootstrap:machine) it
//      DOES exit non-zero on a blocked machine, because there the operator
//      asked and deserves a real answer.
//   2. Installed hook types are read from the filesystem, never assumed. The
//      hand-fix this replaces looked complete while two of three types were
//      missing; only listing .git/hooks tells the truth.
//   3. Uses the git COMMON dir, not the git dir. Worktrees each have their own
//      .git file pointing at a shared common dir, and that is where hooks
//      actually live -- reading the per-worktree path would report hooks
//      missing in every worktree forever.
//   4. Environment variables are read with BRACKET access. scripts/tsconfig.json
//      sets noPropertyAccessFromIndexSignature, so process.env.CI is a TS4111
//      error -- caught by //#typecheck:scripts, which lint cannot see.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUIRED_HOOK_TYPES,
  REQUIRED_TOOLS,
  decideBootstrap,
  describeFinding,
} from './bootstrap-machine.js';

const NL = String.fromCharCode(10);
const PREFIX = '[bootstrap:machine] ';

/* v8 ignore start -- CLI shell: rules above are unit-tested, this is I/O only */
function say(message: string): void {
  process.stderr.write(PREFIX + message + NL);
}

function binaryPresent(name: string): boolean {
  return spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' }).status === 0;
}

/** CI detection. GITHUB_ACTIONS covers this repo's workflows; CI is the generic
 *  convention every other runner sets. Either is enough. */
function isCi(): boolean {
  return process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
}

function gitCommonDir(): string | null {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function installedHookTypes(commonDir: string): readonly string[] {
  const hooksDir = join(commonDir, 'hooks');
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir).filter(
    (name) => !name.endsWith('.sample') && REQUIRED_HOOK_TYPES.includes(name),
  );
}

/** Only a hook file pre-commit itself wrote counts. A hand-rolled or husky hook
 *  of the same name would otherwise read as installed while running none of the
 *  configured guards -- the exact "looks done, does nothing" failure this whole
 *  arc exists to remove. */
function writtenByPreCommit(commonDir: string, hookType: string): boolean {
  const path = join(commonDir, 'hooks', hookType);
  if (!existsSync(path)) return false;
  return readFileSync(path, 'utf-8').includes('pre-commit');
}

function verifiedHookTypes(commonDir: string): readonly string[] {
  return installedHookTypes(commonDir).filter((t) => writtenByPreCommit(commonDir, t));
}

function installHooks(hookTypes: readonly string[]): boolean {
  const args = ['install'];
  for (const t of hookTypes) args.push('--hook-type', t);
  const r = spawnSync('pre-commit', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0;
}

function main(): number {
  const softFail = process.argv.includes('--soft');

  const commonDir = gitCommonDir();
  if (commonDir === null) {
    say('not a git repository -- nothing to do.');
    return 0;
  }

  const finding = decideBootstrap({
    toolsPresent: REQUIRED_TOOLS.filter(binaryPresent),
    installedHookTypes: verifiedHookTypes(commonDir),
    isCi: isCi(),
  });

  say(describeFinding(finding));

  if (finding.outcome === 'skipped' || finding.outcome === 'ready') return 0;

  if (finding.outcome === 'blocked') return softFail ? 0 : 1;

  if (!installHooks(finding.hookTypes)) {
    say('pre-commit install failed. Run it directly to see why.');
    return softFail ? 0 : 1;
  }

  const after = decideBootstrap({
    toolsPresent: REQUIRED_TOOLS.filter(binaryPresent),
    installedHookTypes: verifiedHookTypes(commonDir),
    isCi: false,
  });
  say(describeFinding(after));
  return after.outcome === 'ready' ? 0 : softFail ? 0 : 1;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) {
  process.exit(main());
}
/* v8 ignore stop */

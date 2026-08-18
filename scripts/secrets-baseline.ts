// scripts/secrets-baseline.ts
// Repo-wide detect-secrets BASELINE op, captured as a reusable task.
//
// WHY THIS EXISTS. detect-secrets runs in pre-commit as
//   - id: detect-secrets
//     args: ['--baseline', '.secrets.baseline']
// so the hook blocks only findings that are NOT already recorded in the tracked
// baseline. When a branch adds files that legitimately contain credential-
// SHAPED but synthetic strings, the baseline must be refreshed or EVERY
// worktree's push is blocked -- not just the branch that introduced them.
//
// That is exactly what happened on 2026-07-23: the security-guard arc landed
// seven new scripts whose contents are correct by design -- randomBytes
// passwords, RFC 2606 .invalid hosts, SHA-256 topology hashes -- but never
// regenerated the baseline. Every subsequent push failed the hook on files the
// pusher had not touched.
//
// WHY A BASELINE RATHER THAN INLINE PRAGMAS. For genuine false positives both
// are sanctioned, but the baseline is auditable: detect-secrets audit labels
// each finding true/false positive and stores the decision, the file holds
// HASHES not plaintext, and a change to it is reviewable in the PR diff.
// Pragmas are detect-secrets-only (a cloud scanner such as GitGuardian still
// flags the line), they scatter across files, and they drift silently.
//
// WHY A LINE EXCLUSION RATHER THAN A BASELINE ENTRY, for age PUBLIC keys.
// Publishing an age public key grants nothing -- that is the entire premise of
// the scheme. Baselining them would be a treadmill: the recipient list GROWS by
// design, so every laptop ever added would mint another finding, another
// refresh and another audit round, forever. A baseline crowded with benign
// entries is one nobody reads, which is how a real finding slips past.
//
// The exclusion is deliberately narrow. ONLY the age PUBLIC key shape is
// excluded; AGE-SECRET-KEY-* is NOT, and must never be.
//
// NOT A SUPPRESSION TOOL. A real credential must be REMOVED and rotated, never
// baselined.
//
// ---- AUDIT NEEDS A TERMINAL, AND THIS TASK USED TO HANG WITHOUT ONE ----
//
// THE OBSERVED FAILURE, 2026-08-18. `turbo run secrets:baseline -- --audit`
// hung for EIGHT HOURS AND FIVE MINUTES before it was killed. detect-secrets
// audit is an interactive TUI: it prints a finding and blocks on stdin for
// (y)es/(n)o/(s)kip/(q)uit. Turbo CAPTURES its child's stdio to prefix output
// with the task name, so `stdio: 'inherit'` below inherits a PIPE, not a TTY --
// the prompt is buffered, arrives after the reader has given up, and the child
// waits on a keystroke that can never come. Nothing timed out and nothing
// reported a reason.
//
// Worse, this file's own success message TOLD the operator to run that exact
// command. A task whose remedy cannot be executed is the same defect class as a
// gate whose verdict nobody can act on.
//
// 2026 practice names this bug directly: a CLI that "falls through to
// interactive mode without a real terminal attached hangs indefinitely with
// zero diagnostic output", and the remedy is to GATE on stdin being a TTY and
// take the non-interactive path otherwise -- the same fix pnpm applied to its
// build-scripts approval prompt after it stalled CI runs. npm settled which
// stream matters: "it's really only stdin that we care about there".
//
// So audit now REFUSES when stdin is not a TTY, names the reason, and prints
// the invocation that does work. It does not attempt a non-interactive audit:
// labelling a finding true or false positive is a HUMAN judgement, and a task
// that auto-answered would be manufacturing the audit trail the baseline exists
// to provide.
//
// Pure planners (scanArgs / auditArgs / selectMode / auditNeedsTty /
// pickDetectSecretsBinary) are unit-tested; the side-effecting main() runs ONLY
// as entrypoint.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The tracked baseline the pre-commit hook reads. */
export const BASELINE_FILE = '.secrets.baseline';

// Mirrors the exclude list in .pre-commit-config.yaml. Machine-generated files
// are pure noise for a secret scanner, and the baseline itself stores hashes
// that look like high-entropy strings, so scanning it would be self-referential.
export const EXCLUDE_PATTERNS: readonly string[] = [
  'pnpm-lock[.]yaml',
  'package-lock[.]json',
  'yarn[.]lock',
  '[.]lock',
  '[.]log',
  '[.]secrets[.]baseline',
];

// An age recipient is bech32: the literal prefix age1 then 58 characters from
// the bech32 charset (no 1, b, i or o). Length-anchored, so a short age-prefixed
// string is not excluded, and prefix-anchored on age1, so AGE-SECRET-KEY-* --
// the PRIVATE half -- can never match and stays fully scannable.
export const AGE_PUBLIC_KEY_PATTERN = 'age1[02-9ac-hj-np-z]{58}';

// Line-level exclusions: shapes that are structurally NOT secrets wherever they
// appear. Distinct from EXCLUDE_PATTERNS, which skips whole FILES.
export const EXCLUDE_LINE_PATTERNS: readonly string[] = [AGE_PUBLIC_KEY_PATTERN];

function excludeArgs(): string[] {
  return ['--exclude-files', EXCLUDE_PATTERNS.join('|')];
}

function excludeLineArgs(): string[] {
  return ['--exclude-lines', EXCLUDE_LINE_PATTERNS.join('|')];
}

// Refresh the baseline IN PLACE. Passing --baseline preserves the is_secret
// labels a previous audit recorded; the common shell form
// 'detect-secrets scan > .secrets.baseline' silently discards every one of
// them, which is why this task never redirects output.
export function scanArgs(baseline: string): string[] {
  return ['scan', '--baseline', baseline, ...excludeArgs(), ...excludeLineArgs()];
}

// Walk the baseline interactively so each finding is labelled a true or false
// positive, building the audit trail that makes the baseline reviewable.
export function auditArgs(baseline: string): string[] {
  return ['audit', baseline];
}

export type BaselineMode = 'scan' | 'audit';

// pnpm run <script> -- <args> forwards a literal -- as argv[0]; strip it so the
// mode still resolves (same defect class fixed in gate-integration.ts).
export function selectMode(argv: readonly string[]): BaselineMode {
  return argv.some((a) => a === '--audit') ? 'audit' : 'scan';
}

/** Whether the requested mode can actually run here.
 *
 *  PURE, taking the TTY fact as an argument rather than reading process.stdin,
 *  so the branch that hung for eight hours is reachable in a unit test. That is
 *  the point: the original had no such branch, so no test could have caught it.
 *
 *  Only stdin matters. stdout may be redirected to a file or a pager while the
 *  prompt still works, but a prompt with no keyboard behind it can never be
 *  answered.
 *
 *  The caller passes process.stdin.isTTY DIRECTLY. An earlier revision wrote
 *  `=== true`, defending against an undefined the type system had already
 *  excluded -- the redundant-check anti-pattern this repo names elsewhere, and
 *  the second time in one session that a lint rule caught me guarding a state
 *  the types make unrepresentable. */
export function auditNeedsTty(mode: BaselineMode, stdinIsTty: boolean): boolean {
  return mode === 'audit' && !stdinIsTty;
}

// PURE: choose which detect-secrets to run. The baseline must be written by the
// SAME version the hook enforces (.pre-commit-config.yaml pins rev v1.5.0), and
// pre-commit already installs exactly that version into its managed virtualenv.
// Preferring that binary removes version drift by construction; a separately
// installed PATH copy could write a baseline the hook then rejects.
export function pickDetectSecretsBinary(found: readonly string[]): string {
  return found[0] ?? 'detect-secrets';
}

/* v8 ignore start -- side-effecting entrypoint; pure planners above are unit-tested */
// Locate detect-secrets inside pre-commit's managed environments. Layout:
//   ~/.cache/pre-commit/repo<hash>/py_env-<python>/bin/detect-secrets
function findPreCommitBinaries(): string[] {
  const root = join(homedir(), '.cache', 'pre-commit');
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const repo of readdirSync(root)) {
    const repoDir = join(root, repo);
    let envs: string[];
    try {
      envs = readdirSync(repoDir);
    } catch {
      continue;
    }
    for (const env of envs) {
      if (!env.startsWith('py_env')) continue;
      const candidate = join(repoDir, env, 'bin', 'detect-secrets');
      if (existsSync(candidate)) out.push(candidate);
    }
  }
  return out.sort();
}

function mainSecretsBaseline(): number {
  const argv = process.argv.slice(2);
  const mode = selectMode(argv);
  const nl = String.fromCharCode(10);
  const bin = pickDetectSecretsBinary(findPreCommitBinaries());

  // REFUSE BEFORE SPAWNING. The child would block on a prompt nobody can answer,
  // and an eight-hour stall reports nothing an operator can act on.
  if (auditNeedsTty(mode, process.stdin.isTTY)) {
    process.stderr.write(
      '[secrets:baseline] CANNOT AUDIT: stdin is not a terminal.' + nl +
      '[secrets:baseline] detect-secrets audit is an interactive prompt, and this' + nl +
      '[secrets:baseline] process has no keyboard behind it -- most likely because' + nl +
      '[secrets:baseline] turbo captures child stdio to prefix output. Running it' + nl +
      '[secrets:baseline] anyway would block forever with no diagnostic.' + nl +
      '[secrets:baseline]' + nl +
      '[secrets:baseline] Run it directly, where stdio is inherited from your shell:' + nl +
      '[secrets:baseline]   pnpm run secrets:baseline -- --audit' + nl +
      '[secrets:baseline]' + nl +
      '[secrets:baseline] This is NOT auto-answered on purpose: labelling a finding a' + nl +
      '[secrets:baseline] true or false positive is a human judgement, and a task that' + nl +
      '[secrets:baseline] answered for you would manufacture the audit trail the' + nl +
      '[secrets:baseline] baseline exists to provide.' + nl,
    );
    return 3;
  }

  const args = mode === 'audit' ? auditArgs(BASELINE_FILE) : scanArgs(BASELINE_FILE);
  process.stderr.write('[secrets:baseline] ' + bin + ' ' + args.join(' ') + nl);
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.error !== undefined) {
    process.stderr.write(
      '[secrets:baseline] could not run detect-secrets. It normally ships with the' + nl +
      '[secrets:baseline] pre-commit environment; run "pre-commit install-hooks" to' + nl +
      '[secrets:baseline] provision it, or install it directly (pipx install' + nl +
      '[secrets:baseline] detect-secrets) matching the rev pinned in' + nl +
      '[secrets:baseline] .pre-commit-config.yaml.' + nl,
    );
    return 2;
  }
  // A null status with no error means a SIGNAL killed the child -- Ctrl-C on the
  // audit prompt, most often. Not a scan failure, and not worth reporting as one.
  if (r.status === null) {
    process.stderr.write('[secrets:baseline] detect-secrets was terminated by a signal.' + nl);
    return 130;
  }
  if (mode === 'scan' && r.status === 0) {
    process.stderr.write(
      '[secrets:baseline] baseline refreshed. Review the diff, then AUDIT any new' + nl +
      '[secrets:baseline] entry before committing:' + nl +
      '[secrets:baseline]   pnpm run secrets:baseline -- --audit' + nl +
      '[secrets:baseline] (directly, NOT through turbo: the audit prompt needs a TTY)' + nl,
    );
  }
  return r.status;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('secrets-baseline.ts') || invoked.endsWith('secrets-baseline.js')) {
  process.exit(mainSecretsBaseline());
}
/* v8 ignore stop */

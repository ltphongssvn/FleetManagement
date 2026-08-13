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
// seven new scripts (local-secret-guard, prod-db-url and their tests, plus a
// hash config) whose contents are correct by design -- randomBytes passwords,
// RFC 2606 .invalid hosts, SHA-256 topology hashes, and a task named
// guard:local-secrets -- but never regenerated the baseline. Every subsequent
// push failed the hook on files the pusher had not touched.
//
// Before this task the refresh was an un-captured CLI incantation: not
// rediscoverable, and free to drift from the hook's own flags. Registering it
// as //#secrets:baseline gives ONE definition of those flags and a name a
// teammate can find.
//
// WHY A BASELINE RATHER THAN INLINE PRAGMAS. For genuine false positives both
// are sanctioned, but the baseline is auditable: detect-secrets audit labels
// each finding true/false positive and stores the decision, the file holds
// HASHES not plaintext, and a change to it is reviewable in the PR diff.
// Pragmas are detect-secrets-only (a cloud scanner such as GitGuardian still
// flags the line), they scatter across files, and they drift silently. Use a
// pragma only for a one-off line; use this task for a repo-wide refresh.
//
// WHY A LINE EXCLUSION RATHER THAN A BASELINE ENTRY, for age PUBLIC keys.
// Added 2026-08-10 after the SOPS/age bootstrap arc: detect-secrets flagged
// seven Base64HighEntropyString findings, every one an age PUBLIC key in
// .sops.yaml or a test fixture. Publishing an age public key grants nothing --
// that is the entire premise of the scheme, and the recipient list is tracked
// in git ON PURPOSE.
//
// Baselining them would have worked and would have been a treadmill: the
// recipient list GROWS by design, so every laptop ever added to
// .age-recipients would mint another high-entropy finding, another refresh and
// another audit round, forever, for values published deliberately. A baseline
// crowded with benign entries is one nobody reads, which is how a real finding
// slips past. detect-secrets has the right layer for a structurally-non-secret
// shape -- filters, added expressly to weed out false positives -- and
// --exclude-lines is its config-only form: declared once, applies to every file
// and every future key.
//
// The exclusion is deliberately narrow. ONLY the age PUBLIC key shape is
// excluded; AGE-SECRET-KEY-* is NOT, and must never be. A private identity in
// tracked source is a genuine incident, and both the PrivateKeyDetector plugin
// and the detect-private-key hook must keep their shot at it.
//
// NOT A SUPPRESSION TOOL. A real credential must be REMOVED and rotated, never
// baselined. Run the audit mode before committing a refreshed baseline so every
// new entry has been looked at by a human:
//   pnpm exec turbo run secrets:baseline -- --audit
//
// Pure planners (scanArgs / auditArgs / selectMode / pickDetectSecretsBinary)
// are unit-tested; the side-effecting main() runs ONLY as entrypoint.
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

// PURE: choose which detect-secrets to run. The baseline must be written by the
// SAME version the hook enforces (.pre-commit-config.yaml pins rev v1.5.0), and
// pre-commit already installs exactly that version into its managed virtualenv.
// Preferring that binary removes version drift by construction; a separately
// installed PATH copy could write a baseline the hook then rejects. Falls back
// to the bare command name so the task still works wherever detect-secrets is
// on PATH (e.g. CI images that install it directly).
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
  const args = mode === 'audit' ? auditArgs(BASELINE_FILE) : scanArgs(BASELINE_FILE);
  const bin = pickDetectSecretsBinary(findPreCommitBinaries());
  const nl = String.fromCharCode(10);
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
  if (mode === 'scan' && (r.status ?? 1) === 0) {
    process.stderr.write(
      '[secrets:baseline] baseline refreshed. Review the diff, then AUDIT any new' + nl +
      '[secrets:baseline] entry before committing:' + nl +
      '[secrets:baseline]   pnpm exec turbo run secrets:baseline -- --audit' + nl,
    );
  }
  return r.status ?? 1;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('secrets-baseline.ts') || invoked.endsWith('secrets-baseline.js')) {
  process.exit(mainSecretsBaseline());
}
/* v8 ignore stop */

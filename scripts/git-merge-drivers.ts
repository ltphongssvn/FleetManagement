// scripts/git-merge-drivers.ts
// Pure declarations for the generated-file merge driver. No I/O here; the thin
// registrar at the bottom is the only side-effecting part.
//
// ROOT CAUSE THIS ELIMINATES
// .secrets.baseline is GENERATED. detect-secrets rewrites generated_at on every
// refresh, and line_number shifts whenever any scanned file gains a line. Two
// branches that both touched it therefore conflict on content that carries no
// meaning whatsoever. It conflicted twice in one session on nothing but the
// timestamp, and commit c074d43 shows a different terminal spending a whole
// commit on the same churn. Across fifty-plus live worktrees this is a standing
// tax on every merge.
//
// git already solves this: declare the path in .gitattributes with a custom
// merge driver, and register the driver body in git config. keep-theirs takes
// the incoming side, which git hands the driver as %B, and writes it to %A.
//
// Taking THEIRS is the correct side for this file specifically: origin/develop
// is the integration truth, and the detect-secrets pre-commit hook plus the
// secrets:baseline task regenerate the line numbers locally immediately after.
// A stale timestamp or line number is self-healing; a hand-resolved conflict is
// not.
//
// SAFETY: this driver silently discards one side, so it must NEVER be pointed
// at hand-written source. The allowlist is a short, literal, asserted list --
// never a glob. pnpm-lock.yaml is deliberately excluded: it is generated too,
// but a wrong resolution there is a real dependency change, not noise.

export const DRIVER_NAME = 'keep-theirs';

export const GENERATED_FILES: readonly string[] = ['.secrets.baseline'];

export interface ConfigEntry {
  readonly key: string;
  readonly value: string;
}

export function gitattributesContent(): string {
  const header = [
    '# Merge behaviour for GENERATED files.',
    '#',
    '# These files are produced by tooling, not written by hand. They churn on',
    '# every regeneration (timestamps, shifted line numbers), so parallel branches',
    '# conflict on content that carries no meaning. The keep-theirs driver resolves',
    '# them to the incoming side; the generating task then refreshes them locally.',
    '#',
    '# The driver DISCARDS one side, so never add hand-written source here. Run',
    '# pnpm exec turbo run git:merge-drivers to register the driver body, which',
    '# lives in git config and therefore cannot be versioned in this file.',
  ];
  const rules = GENERATED_FILES.map((f) => f + ' merge=' + DRIVER_NAME);
  return [...header, ...rules].join(nlChar()) + nlChar();
}

function nlChar(): string {
  return String.fromCharCode(10);
}

// %A is the file git wants written, %B the incoming side. Exit 0 tells git the
// merge succeeded.
export function driverConfigEntries(): readonly ConfigEntry[] {
  return [
    { key: 'merge.' + DRIVER_NAME + '.name', value: 'keep the incoming side for generated files' },
    { key: 'merge.' + DRIVER_NAME + '.driver', value: 'cp -f %B %A' },
  ];
}

// --local, never --global: this is a property of THIS repository, and writing a
// driver into a developer global config would silently change merge behaviour
// in unrelated projects.
export function gitConfigArgs(key: string, value: string): readonly string[] {
  if (key.trim().length === 0) {
    throw new Error('gitConfigArgs: key must not be blank');
  }
  return ['config', '--local', key, value];
}

// Idempotence check. A DIFFERENT value counts as unregistered so a changed
// driver body is re-applied rather than silently left stale.
export function isRegistered(existing: ReadonlyMap<string, string>): boolean {
  return driverConfigEntries().every((e) => existing.get(e.key) === e.value);
}

/* v8 ignore start */

// Imperative shell: writes .gitattributes and registers the driver body in the
// LOCAL git config. Idempotent, so it is safe to run on every worktree preflight.
// The config half cannot be versioned, which is exactly why this is a committed
// task rather than a line in a setup document nobody runs.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

function readExisting(): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const entry of driverConfigEntries()) {
    const r = spawnSync('git', ['config', '--local', '--get', entry.key], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status === 0) out.set(entry.key, (r.stdout || '').trim());
  }
  return out;
}

function main(): void {
  const desired = gitattributesContent();
  let current = '';
  try {
    current = readFileSync('.gitattributes', 'utf8');
  } catch {
    // absent on first run
  }
  if (current !== desired) {
    writeFileSync('.gitattributes', desired, 'utf8');
    console.error('git:merge-drivers: wrote .gitattributes');
  } else {
    console.error('git:merge-drivers: .gitattributes already current');
  }

  if (isRegistered(readExisting())) {
    console.error('git:merge-drivers: driver already registered in local git config');
    return;
  }
  for (const entry of driverConfigEntries()) {
    const r = spawnSync('git', gitConfigArgs(entry.key, entry.value) as string[], {
      stdio: 'inherit',
    });
    if (r.status !== 0) {
      console.error('git:merge-drivers: failed to set ' + entry.key);
      process.exit(1);
    }
  }
  console.error('git:merge-drivers: registered ' + DRIVER_NAME + ' for ' + GENERATED_FILES.join(', '));
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { main(); }

/* v8 ignore stop */

// scripts/machine-doctor-cli.ts
// IMPERATIVE SHELL for the machine doctor. Gathers facts and prints; every
// verdict lives in machine-doctor.ts (pure), mirroring the env-bootstrap and
// bootstrap-machine splits.
//
// READ-ONLY BY DESIGN. It diagnoses and never repairs, even though every
// remediation it prints is a registered op it could invoke. The repo already
// draws this line: //#sync:worktrees reports drift and refuses to install,
// because an implicit install across dozens of worktrees is destructive, and
// //#deps:reconcile exists so that INVOKING it is the operator deciding. A
// doctor that silently started Docker, generated an age identity or rewrote git
// config would be the same violation wearing a helpful face.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import {
  diagnose,
  overallExit,
  type CapabilityStatus,
  type CheckInput,
  type Finding,
} from './machine-doctor.js';

const NL = String.fromCharCode(10);

/* v8 ignore start -- CLI shell: every rule is unit-tested, this is I/O only */
function out(line: string): void {
  process.stdout.write(line + NL);
}

function binaryPresent(name: string): boolean {
  return spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' }).status === 0;
}

/** Hook types actually installed, read from the git COMMON dir -- worktrees
 *  share one hooks directory, so the per-worktree path would report every
 *  worktree broken forever. Counts a hook only when pre-commit wrote it, so a
 *  hand-rolled file of the same name cannot read as installed. */
function installedHookTypes(): readonly string[] {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) return [];
  const hooksDir = join(r.stdout.trim(), 'hooks');
  return ['commit-msg', 'pre-commit', 'pre-push'].filter((hook) => {
    const path = join(hooksDir, hook);
    if (!existsSync(path)) return false;
    try {
      return readFileSync(path, 'utf-8').includes('pre-commit');
    } catch {
      return false;
    }
  });
}

/** docker info answers only when the daemon is REACHABLE, and costs no image
 *  pull, no container and no network. The same probe gate-coverage uses. */
function containerRuntimeUp(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

/** Is this host listed in the tracked recipient roster? Matched by the age
 *  PUBLIC key derived from the local identity, never by hostname: the comment
 *  naming a host is prose, and prose doing an assertion's job is the defect the
 *  roster guard was written to end. */
function isRecipient(repoRoot: string, identityPath: string): boolean {
  if (!existsSync(identityPath)) return false;
  const derived = spawnSync('age-keygen', ['-y', identityPath], { encoding: 'utf-8' });
  if (derived.status !== 0) return false;
  const publicKey = derived.stdout.trim();
  if (publicKey.length === 0) return false;
  try {
    return readFileSync(join(repoRoot, '.age-recipients'), 'utf-8').includes(publicKey);
  } catch {
    return false;
  }
}

/** A merge driver declared in .gitattributes does NOTHING until registered in
 *  git config, and git config is not versionable -- which is why this is a
 *  run-once-per-clone op that nothing has ever surfaced. */
function mergeDriverRegistered(): boolean {
  const r = spawnSync('git', ['config', '--get', 'merge.keep-theirs.driver'], {
    encoding: 'utf-8',
  });
  return r.status === 0 && r.stdout.trim().length > 0;
}

function repoRoot(): string {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}

function gather(): CheckInput {
  const root = repoRoot();
  const identityPath =
    process.env['SOPS_AGE_KEY_FILE'] ?? join(homedir(), '.config', 'sops', 'age', 'keys.txt');
  const wanted = [
    'git',
    'gh',
    'pnpm',
    'node',
    'pre-commit',
    'detect-secrets',
    'sops',
    'age',
    'docker',
  ];
  return {
    binaries: wanted.filter(binaryPresent),
    hookTypes: installedHookTypes(),
    containerRuntimeUp: containerRuntimeUp(),
    ageIdentityPresent: existsSync(identityPath),
    isRecipient: isRecipient(root, identityPath),
    ciphertextPresent: existsSync(join(root, '.env.sops.yaml')),
    mergeDriverRegistered: mergeDriverRegistered(),
  };
}

/** Keyed by the CLOSED status union rather than by string, so the lookup is
 *  total and noUncheckedIndexedAccess has nothing to widen. A cast would have
 *  silenced the same warning while leaving a real hole. */
const MARK: Readonly<Record<CapabilityStatus, string>> = {
  ready: 'OK     ',
  broken: 'BROKEN ',
  blocked: 'BLOCKED',
};

function report(findings: readonly Finding[]): void {
  out('');
  out('machine doctor -- ' + hostname());
  out('');
  for (const f of findings) {
    out(MARK[f.status] + '  ' + f.id + '  --  ' + f.summary);
    if (f.remediation.length > 0) out('           fix: ' + f.remediation);
  }
  out('');
  const broken = findings.filter((f) => f.status === 'broken').length;
  const blocked = findings.filter((f) => f.status === 'blocked').length;
  if (broken > 0) {
    out(
      String(broken) + ' capability(ies) BROKEN -- fixable on this machine, see fix lines above.',
    );
  }
  if (blocked > 0) {
    out(
      String(blocked) +
        ' capability(ies) BLOCKED -- waiting on an action only another host can take. Not a fault of this machine, so this does not fail the check.',
    );
  }
  if (broken === 0 && blocked === 0) out('every capability ready.');
  out('');
}

function main(): number {
  const findings = diagnose(gather());
  report(findings);
  return overallExit(findings);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) {
  process.exit(main());
}
/* v8 ignore stop */

// scripts/env-file-guard-cli.ts
// IMPERATIVE SHELL for the env-file commit guard. Argv and git in, exit code
// out. Every DECISION lives in env-file-guard.ts and is unit-tested there; what
// lives here is wiring too small to hide a defect, mirroring the
// local-secret-guard and terminal-registry-cli splits.
//
// READS THE INDEX, NOT THE WORKING TREE. git show ":<path>" prints the STAGED
// blob. That distinction is the whole point: the index is what becomes the
// commit, and a file decrypted for debugging and left decrypted in the working
// tree is one of the most common ways plaintext reaches history. Checking the
// worktree would pass a commit whose staged content is plaintext, and fail a
// commit whose staged content is fine.
//
// --diff-filter=ACM covers Added, Copied and Modified. Deletions are excluded
// deliberately: removing a plaintext env file from the index is the remedy this
// guard asks for, so blocking it would trap the operator.
//
// EXIT CODES follow the house vocabulary: 0 clean, 1 violation, 2 tooling
// error. A tooling error is distinct because "git is unavailable" and "a secret
// is staged" demand opposite responses, and a guard that reports the same code
// for both teaches the operator to ignore it.
import { spawnSync } from 'node:child_process';
import { classifyEnvPath, describeEnvViolation, isEnvPath } from './env-file-guard.js';

export const ENV_GUARD_EXIT = {
  ok: 0,
  violation: 1,
  toolingError: 2,
} as const;

/* v8 ignore start -- side-effecting driver; the decisions above are unit-tested */
const NL = String.fromCharCode(10);

function stagedPaths(): readonly string[] | null {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  if (r.error !== undefined || (r.status ?? 1) !== 0) return null;
  return r.stdout.split(NL).filter((p) => p.length > 0);
}

function stagedContents(path: string): string | null {
  const r = spawnSync('git', ['show', ':' + path], { encoding: 'utf8' });
  if (r.error !== undefined || (r.status ?? 1) !== 0) return null;
  return r.stdout;
}

function main(): number {
  const paths = stagedPaths();
  if (paths === null) {
    process.stderr.write('[guard:env-files] could not read the git index.' + NL);
    return ENV_GUARD_EXIT.toolingError;
  }
  let violations = 0;
  for (const path of paths) {
    if (!isEnvPath(path)) continue;
    const contents = stagedContents(path);
    if (contents === null) {
      process.stderr.write('[guard:env-files] could not read staged blob: ' + path + NL);
      return ENV_GUARD_EXIT.toolingError;
    }
    const decision = classifyEnvPath(path, contents);
    if (!decision.allowed) {
      process.stderr.write(describeEnvViolation(path, decision) + NL);
      violations += 1;
    }
  }
  return violations === 0 ? ENV_GUARD_EXIT.ok : ENV_GUARD_EXIT.violation;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('env-file-guard-cli.ts') || invoked.endsWith('env-file-guard-cli.js')) {
  process.exit(main());
}
/* v8 ignore stop */

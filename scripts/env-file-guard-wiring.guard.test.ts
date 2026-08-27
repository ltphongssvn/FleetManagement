// scripts/env-file-guard-wiring.guard.test.ts
// ARCHITECTURAL GUARD: the env-file guard must be REACHABLE, and the pre-commit
// hook must delegate to it rather than carrying a second copy of the rule.
//
// WHY A WIRING GUARD. terminal-registry.ts sat complete and unit-tested for
// months while no task called it, so every claim was still hand-typed; correct
// code nobody can reach is not a capability. That failure has recurred three
// times in recent arcs -- a domain SSOT missing from a barrel, a contract
// symbol never exported, a normalizer stranded on an unmerged branch. This file
// asserts the wiring exists so the same shape cannot recur here.
//
// WHY THE HOOK MUST NOT KEEP ITS OWN REGEX. The defect this arc fixes was
// exactly that: check-env-files carried an inline grep whose pattern
// contradicted the .gitignore allowlist, and because the rule lived in a shell
// one-liner it was untestable and drifted silently. A hook that delegates to a
// registered script gets the script's 17 unit tests for free; a hook with an
// inline pattern gets none, forever.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8');

const packageJson = read('package.json');
const turboJsonc = read('turbo.jsonc');
const preCommit = read('.pre-commit-config.yaml');
const gitignore = read('.gitignore');

/** The task DEFINITION, located by its opening brace.
 *
 *  Anchoring on the bare name would match the __ci_fast__ dependency list ~140
 *  lines earlier and slice a window containing no task at all -- which is
 *  exactly what the first draft did, producing a failure that named the
 *  description while the description was fine. A test that fails for a reason
 *  other than the one it states is worse than no test, because it sends the
 *  next reader to the wrong file. */
function taskBlock(): string {
  const idx = turboJsonc.indexOf('"//#guard:env-files": {');
  expect(idx).toBeGreaterThan(-1);
  return turboJsonc.slice(idx, idx + 4000);
}

describe('the guard is registered as a runnable op', () => {
  it('package.json exposes guard:env-files as a root script', () => {
    expect(packageJson).toContain('"guard:env-files"');
  });

  it('the script points at the CLI shell, not the pure core', () => {
    expect(packageJson).toContain('tsx scripts/env-file-guard-cli.ts');
  });

  it('turbo.jsonc registers it as a ROOT task', () => {
    expect(turboJsonc).toContain('"//#guard:env-files": {');
  });

  it('the task is uncached -- it reads git index state outside the task graph', () => {
    expect(taskBlock()).toContain('"cache": false');
  });

  it('the task carries a description explaining WHY, not just what', () => {
    const block = taskBlock();
    expect(block).toContain('"description"');
    expect(block).toContain('.env.sops.yaml');
  });

  it('the task is also WIRED INTO the __ci_fast__ gate', () => {
    // Registration and invocation are different things: a task nothing calls is
    // the correct-code-nobody-can-reach failure this repo has closed five times.
    expect(turboJsonc).toContain('"//#guard:env-files",');
  });
});

describe('the pre-commit hook delegates instead of duplicating the rule', () => {
  it('check-env-files invokes the registered script', () => {
    expect(preCommit).toContain('guard:env-files');
  });

  it('the hook no longer carries its own env-path regex', () => {
    // The inline pattern is what drifted from .gitignore. Its absence is the
    // fix; asserting it keeps a future edit from reintroducing the copy.
    expect(preCommit).not.toContain('(^|/)\\.env(\\..+)?$');
  });

  it('the hook follows the repo bash-safety contract', () => {
    // .pre-commit-config.yaml documents this as mandatory: an if/then/else gate
    // rather than cmd && cmd || echo, because bash parses the latter so that a
    // real non-zero exit falls through to the echo branch and the hook reports
    // success. That swallowed failure is how a broken commit reaches CI.
    expect(preCommit).toContain(
      'if command -v pnpm >/dev/null && [ -f pnpm-lock.yaml ]; then pnpm run guard:env-files;',
    );
  });
});

describe('the guard and .gitignore agree about the ciphertext', () => {
  it('.gitignore un-ignores the ciphertext by EXACT name', () => {
    expect(gitignore).toContain('!.env.sops.yaml');
  });

  it('.gitignore does not use a glob to un-ignore it', () => {
    // A glob such as !.env.*.yaml would silently admit any future file that
    // happens to match, which is the trap the allowlist exists to avoid.
    expect(gitignore).not.toContain('!.env.*.yaml');
  });
});

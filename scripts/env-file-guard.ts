// scripts/env-file-guard.ts
// PURE CORE for the env-file commit guard: which env files may enter the index.
//
// WHY THIS EXISTS. .gitignore carries "!.env.sops.yaml" -- deliberately
// UN-ignoring the SOPS ciphertext, because that file is how every machine
// bootstraps and it is tracked on purpose. The pre-commit hook check-env-files
// never learned about it: its pattern is (^|/)[.]env([.].+)?$ with a single
// exemption for .env.example, so it matches .env.sops.yaml and blocks it.
//
// Two layers of the same policy therefore contradicted each other. .gitignore
// said "track this file"; the hook said "never". The only way to commit the
// ciphertext was git commit --no-verify, and that is what happened. A gate that
// must be bypassed to do the RIGHT thing is a gate that will be bypassed to do
// the wrong one -- 2026 secret-scanning guidance names --no-verify as the
// critical gap in pre-commit enforcement, which is exactly why the rule has to
// be CORRECT rather than merely strict.
//
// A NAME ALLOWLIST IS NOT ENOUGH, and that is the substance of this module.
// Exempting the NAME .env.sops.yaml would pass a PLAINTEXT file carrying that
// name -- the precise failure the .gitignore comment warns about when it insists
// the allowlist be exact rather than a glob. Name-exactness proves nothing about
// contents. The exemption is therefore CONDITIONAL on the file actually being
// SOPS-encrypted: assert what it IS, not what it is called. 2026 guidance for
// sops pre-commit hooks says the same thing in the positive -- verify the file
// is recognised as encrypted, rather than trusting a path convention.
//
// PURE: every decision is a function of (path, contents). No git, no disk, no
// process spawning, so every branch is unit-testable. The imperative shell in
// env-file-guard-cli.ts reads the STAGED blob -- never the working tree, since
// the index is what becomes the commit and a decrypted-for-debugging working
// copy is one of the most common ways plaintext reaches history.

/** Template file, tracked on purpose. Contents are placeholders by convention,
 *  and detect-secrets scans it independently, so no content check is applied. */
export const ALLOWED_PLAINTEXT_ENV_FILE = '.env.example';

/** SOPS ciphertext, tracked on purpose: values encrypted, field names legible.
 *  Allowed ONLY when the contents prove it is encrypted. */
export const ALLOWED_ENCRYPTED_ENV_FILE = '.env.sops.yaml';

/** Why a staged env file was refused. Distinct codes because the remedies
 *  differ: plaintext must be removed from the index, whereas a ciphertext-named
 *  file holding plaintext must be re-encrypted. */
export const ENV_GUARD_REFUSALS = Object.freeze([
  'plaintext_env_file',
  'ciphertext_name_but_not_encrypted',
] as const);
export type EnvGuardRefusal = (typeof ENV_GUARD_REFUSALS)[number];

export type EnvPathDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: EnvGuardRefusal };

const SEP = '/';

/** The basename of a path, without importing node:path -- this module stays
 *  dependency-free so it can be unit-tested and reused anywhere. */
function baseNameOf(path: string): string {
  const idx = path.lastIndexOf(SEP);
  return idx === -1 ? path : path.slice(idx + 1);
}

/** True when the path names an env file: exactly .env, or .env followed by a
 *  suffix, at the repo root or in ANY directory.
 *
 *  Anchored on the BASENAME so scripts/env-file-guard.ts and
 *  apps/api/src/config/env.config.ts are not matched -- a substring rule would
 *  flag this very file, and a guard that flags its own source is one somebody
 *  disables. */
export function isEnvPath(path: string): boolean {
  const base = baseNameOf(path);
  return base === '.env' || base.startsWith('.env.');
}

/** True when the contents are a SOPS-encrypted document.
 *
 *  BOTH signals are required. The sops: block alone can be present on a file
 *  whose values were never encrypted (a hand-edited or partially-decrypted
 *  document), and an ENC[...] value alone can appear in a file with no MAC --
 *  neither is safe to commit, and requiring both is what makes this a proof
 *  rather than a heuristic. */
export function looksSopsEncrypted(contents: string): boolean {
  const hasMac = contents.split(String.fromCharCode(10)).some((l) => l.startsWith('sops:'));
  const hasEncryptedValue = contents.includes('ENC[AES256_GCM');
  return hasMac && hasEncryptedValue;
}

/** Decide whether a staged env file may enter the index.
 *
 *  .env.example passes unconditionally: it is a template, and its contents are
 *  already covered by detect-secrets. .env.sops.yaml passes ONLY when
 *  looksSopsEncrypted proves it. Everything else is refused. */
export function classifyEnvPath(path: string, contents: string): EnvPathDecision {
  const base = baseNameOf(path);
  if (base === ALLOWED_PLAINTEXT_ENV_FILE) return { allowed: true };
  if (base === ALLOWED_ENCRYPTED_ENV_FILE) {
    return looksSopsEncrypted(contents)
      ? { allowed: true }
      : { allowed: false, reason: 'ciphertext_name_but_not_encrypted' };
  }
  return { allowed: false, reason: 'plaintext_env_file' };
}

/** Operator-facing message for a refusal. Names the PATH and the CONDITION and
 *  never a value from the file -- the same rule local-secret-guard follows when
 *  it reports a variable name rather than its contents. A guard that echoes the
 *  secret it caught has leaked it into the terminal and CI log. */
export function describeEnvViolation(path: string, decision: EnvPathDecision): string {
  if (decision.allowed) return '';
  if (decision.reason === 'ciphertext_name_but_not_encrypted') {
    return (
      'ERROR - ' +
      path +
      ' is staged but is NOT sops-encrypted. The ciphertext is tracked on ' +
      'purpose; plaintext under that name is not. Re-encrypt with: pnpm run env:encrypt'
    );
  }
  return (
    'ERROR - ' +
    path +
    ' is a plaintext env file and must never be committed. Allowed: ' +
    ALLOWED_PLAINTEXT_ENV_FILE +
    ' (template), ' +
    ALLOWED_ENCRYPTED_ENV_FILE +
    ' (sops ciphertext). Unstage with: git restore --staged ' +
    path
  );
}

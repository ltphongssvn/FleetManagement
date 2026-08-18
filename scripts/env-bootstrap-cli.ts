// scripts/env-bootstrap-cli.ts
// IMPERATIVE SHELL for the SOPS/age env bootstrap. Orchestration only: every
// rule lives in env-bootstrap.ts (pure) and in decideBootstrap below (pure),
// which is why this file spawns processes but decides nothing inline. Mirrors
// terminal-registry-cli.ts, where the same split kept the allocation rule
// testable while the shell stayed thin.
//
// SECRET-HANDLING INVARIANTS, each closing a specific leak:
//   1. The age IDENTITY is passed via SOPS_AGE_KEY_FILE in the environment,
//      never as an argument. argv is visible to every process on the machine
//      through the process table; env is not (on macOS there is no /proc, and
//      on Linux /proc/<pid>/environ is owner-readable only).
//   2. Decrypted output is written to a file with mode 600 and is NEVER echoed
//      to stdout. A CLI that prints plaintext puts secrets into scrollback,
//      terminal history and any CI log that captures the step.
//   3. Refusal messages name the CONDITION, never a value. This is the same
//      reasoning as local-secret-guard reporting a hash prefix rather than a
//      hostname: a guard whose diagnostics leak what it protects is self-defeating.
//   4. EVERY throw passes through formatCliError. Observed 2026-08-09 on the
//      first live run: an empty recipient list let a raw ZodError escape, and
//      the operator got forty lines of stack trace with absolute paths and tsx
//      internals, burying the one actionable sentence. A stack trace is also a
//      leak surface -- node prints the offending source line, which for a parse
//      over secret material can carry a value. One boundary, not a try/catch
//      bolted onto whichever call site happened to fail.
//   5. ENCRYPT VERIFIES ITS OWN OUTPUT. Observed 2026-08-14: a .env with a
//      duplicated key encrypted cleanly and could never be decrypted by anyone,
//      because dotenv permits repeat assignment and YAML does not. Encryption
//      reporting success is not evidence the artifact is readable, so the
//      ciphertext is decrypted back before the run is called done -- the same
//      practice GitOps guidance prescribes for sops files, validating that
//      every encrypted file CAN be decrypted rather than assuming it.
//
// Run:
//   pnpm exec turbo run env:decrypt     -- ciphertext -> .env (new machine)
//   pnpm exec turbo run env:encrypt     -- .env -> ciphertext (after a change)
//   pnpm exec turbo run env:recipients  -- regenerate .sops.yaml from recipients
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ENCRYPTED_ENV_FILE,
  PLAINTEXT_ENV_FILE,
  RECIPIENTS_FILE,
  SOPS_CONFIG_FILE,
  decryptArgs,
  encryptArgs,
  parseRecipients,
  renderSopsConfig,
} from './env-bootstrap.js';
import { describeDuplicates, findDuplicateKeys } from './env-bootstrap-dotenv.js';
import {
  REFUSAL_REASONS,
  type BootstrapMode,
  type RefusalReason,
} from './env-bootstrap-vocabulary.js';

// Re-exported so callers and tests read ONE vocabulary. Declaring these here
// as unions is what let the test keep a stale parallel copy.
export { REFUSAL_REASONS, type BootstrapMode, type RefusalReason };

const NL = String.fromCharCode(10);

/** Binaries the shell cannot work without. Checked BEFORE anything is read. */
export const REQUIRED_BINARIES: readonly string[] = Object.freeze(['sops', 'age']);

/** sops reads the private identity from this variable. Never an argv flag. */
export const IDENTITY_ENV_VAR = 'SOPS_AGE_KEY_FILE';

/** Conventional identity location; overridable via IDENTITY_ENV_VAR. */
export const DEFAULT_IDENTITY_PATH = join(homedir(), '.config', 'sops', 'age', 'keys.txt');



export interface Preconditions {
  readonly sopsPresent: boolean;
  readonly agePresent: boolean;
  readonly identityFilePresent: boolean;
  readonly encryptedFilePresent: boolean;
  readonly plaintextFilePresent: boolean;
  /** True when .env assigns some key more than once. Legal dotenv, illegal
   *  YAML, and therefore ciphertext no recipient could ever open. */
  readonly plaintextHasDuplicateKeys: boolean;
}

export type BootstrapDecision =
  | { readonly outcome: 'proceed' }
  | { readonly outcome: 'refused'; readonly reason: RefusalReason };

/** PURE. Ordered fail-closed gate. Order matters: tooling first (its absence
 *  makes every later check meaningless), then mode-specific file state, then
 *  the CONTENT rule -- a file that exists but cannot survive the round trip is
 *  worse than one that is missing, because the failure surfaces on another
 *  machine at a later date. */
export function decideBootstrap(mode: BootstrapMode, pre: Preconditions): BootstrapDecision {
  if (!pre.sopsPresent || !pre.agePresent) {
    return { outcome: 'refused', reason: 'missing_binary' };
  }
  if (mode === 'encrypt') {
    if (!pre.plaintextFilePresent) {
      return { outcome: 'refused', reason: 'missing_plaintext' };
    }
    if (pre.plaintextHasDuplicateKeys) {
      return { outcome: 'refused', reason: 'duplicate_plaintext_keys' };
    }
    return { outcome: 'proceed' };
  }
  if (!pre.identityFilePresent) {
    return { outcome: 'refused', reason: 'missing_identity' };
  }
  if (!pre.encryptedFilePresent) {
    return { outcome: 'refused', reason: 'missing_encrypted' };
  }
  if (pre.plaintextFilePresent) {
    return { outcome: 'refused', reason: 'would_clobber_plaintext' };
  }
  return { outcome: 'proceed' };
}

/** PURE. Actionable message per refusal. Names the condition and the remedy;
 *  never a value, a path fragment of a secret, or a key. */
export function describeRefusal(reason: RefusalReason): string {
  const messages: Readonly<Record<RefusalReason, string>> = Object.freeze({
    missing_binary:
      'sops and age are required but were not found on PATH. Install both with: brew install sops age',
    missing_identity:
      'No age identity found. Generate one with: age-keygen -o ' +
      DEFAULT_IDENTITY_PATH +
      ' then send the PUBLIC key (printed on stderr) to the repo owner for ' +
      RECIPIENTS_FILE +
      '. Never share the private half.',
    missing_encrypted:
      'The encrypted env file ' +
      ENCRYPTED_ENV_FILE +
      ' is not present in this worktree. It is tracked in git, so this usually means the branch predates it.',
    missing_plaintext:
      'No ' +
      PLAINTEXT_ENV_FILE +
      ' to encrypt. Refusing rather than writing an empty ciphertext over a good one.',
    duplicate_plaintext_keys:
      PLAINTEXT_ENV_FILE +
      ' assigns a key more than once. dotenv allows this and YAML does not, so sops would write ciphertext that NO recipient can ever decrypt (getsops/sops/issues/851). Remove the redundant assignment -- dotenv keeps the LAST one -- and encrypt again.',
    would_clobber_plaintext:
      'A ' +
      PLAINTEXT_ENV_FILE +
      ' already exists. Refusing to overwrite it: local edits would be lost irrecoverably. Move it aside first.',
  });
  return messages[reason];
}

/** Anything shaped like an age PRIVATE key, wherever it appears in a message. */
const PRIVATE_KEY_RE = /AGE-SECRET-KEY-[A-Z0-9]+/g;

/** Absolute POSIX home paths. Stripped so a diagnostic never discloses layout. */
const ABSOLUTE_PATH_RE = /\/(Users|home|root)\/[^\s'")]*/g;

interface ZodLikeIssue {
  readonly message?: unknown;
}

function zodIssues(err: unknown): readonly ZodLikeIssue[] | null {
  if (typeof err !== 'object' || err === null) return null;
  const issues = (err as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as readonly ZodLikeIssue[]) : null;
}

/** PURE. One line, secret-free, path-free, stack-free. The SINGLE formatter
 *  every failure path in this CLI passes through. Zod issues are unwrapped to
 *  their messages so the operator reads the sentence the schema author wrote,
 *  not a serialized issue array. */
export function formatCliError(err: unknown): string {
  const issues = zodIssues(err);
  let raw: string;
  if (issues !== null && issues.length > 0) {
    raw = issues
      .map((issue) => (typeof issue.message === 'string' ? issue.message : 'invalid value'))
      .join('; ');
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'string') {
    raw = err;
  } else {
    raw = 'unknown error';
  }
  return raw
    .replace(PRIVATE_KEY_RE, '[REDACTED]')
    .replace(ABSOLUTE_PATH_RE, '[path]')
    .split(NL)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
}

/* v8 ignore start -- CLI shell: rules above are unit-tested, this is I/O only */
function binaryPresent(name: string): boolean {
  return spawnSync('command', ['-v', name], { shell: true, stdio: 'ignore' }).status === 0;
}

function identityPath(): string {
  const fromEnv = process.env[IDENTITY_ENV_VAR];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_IDENTITY_PATH;
}

function plaintextHasDuplicates(): boolean {
  if (!existsSync(PLAINTEXT_ENV_FILE)) return false;
  return findDuplicateKeys(readFileSync(PLAINTEXT_ENV_FILE, 'utf-8')).length > 0;
}

function readPreconditions(): Preconditions {
  return {
    sopsPresent: binaryPresent('sops'),
    agePresent: binaryPresent('age'),
    identityFilePresent: existsSync(identityPath()),
    encryptedFilePresent: existsSync(ENCRYPTED_ENV_FILE),
    plaintextFilePresent: existsSync(PLAINTEXT_ENV_FILE),
    plaintextHasDuplicateKeys: plaintextHasDuplicates(),
  };
}

function runSops(args: readonly string[]): { stdout: string; code: number } {
  const r = spawnSync('sops', [...args], {
    encoding: 'utf-8',
    env: { ...process.env, [IDENTITY_ENV_VAR]: identityPath() },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // encoding:'utf-8' makes stdout a string, never null, so no ?? fallback is
  // reachable here. status IS nullable: it is null when the child was killed by
  // a signal rather than exiting, which must read as failure, hence ?? 1.
  return { stdout: r.stdout, code: r.status ?? 1 };
}

/** Prove the ciphertext we just wrote can be read back.
 *
 *  Encryption reporting success is NOT evidence the artifact is usable: the
 *  duplicate-key case wrote a file every recipient was permanently locked out
 *  of, and sibling upstream defects do the same for an empty input and for a
 *  double encrypt. Verifying costs one local decrypt and converts a silent,
 *  deferred, cross-machine failure into an immediate one on the machine that
 *  caused it.
 *
 *  A machine without an identity cannot verify -- it can still legitimately
 *  encrypt for others -- so absence of a key is reported, not treated as a
 *  failure of the artifact. */
function verifyRoundTrip(): boolean | null {
  if (!existsSync(identityPath())) return null;
  return runSops(decryptArgs()).code === 0;
}

function decrypt(): number {
  const decision = decideBootstrap('decrypt', readPreconditions());
  if (decision.outcome === 'refused') {
    process.stderr.write('[env] ' + describeRefusal(decision.reason) + NL);
    return 1;
  }
  const r = runSops(decryptArgs());
  if (r.code !== 0) {
    process.stderr.write('[env] sops could not decrypt. Is this machine a recipient?' + NL);
    return 1;
  }
  writeFileSync(PLAINTEXT_ENV_FILE, r.stdout, { mode: 0o600 });
  chmodSync(PLAINTEXT_ENV_FILE, 0o600);
  process.stderr.write('[env] wrote ' + PLAINTEXT_ENV_FILE + ' (mode 600)' + NL);
  return 0;
}

function encrypt(): number {
  const pre = readPreconditions();
  const decision = decideBootstrap('encrypt', pre);
  if (decision.outcome === 'refused') {
    process.stderr.write('[env] ' + describeRefusal(decision.reason) + NL);
    if (decision.reason === 'duplicate_plaintext_keys') {
      const found = findDuplicateKeys(readFileSync(PLAINTEXT_ENV_FILE, 'utf-8'));
      process.stderr.write(describeDuplicates(found) + NL);
    }
    return 1;
  }
  const existedBefore = pre.encryptedFilePresent;
  const r = runSops(encryptArgs());
  if (r.code !== 0) {
    process.stderr.write('[env] sops could not encrypt.' + NL);
    return 1;
  }
  const verified = verifyRoundTrip();
  if (verified === false) {
    // The artifact is unreadable. Leaving it on disk invites committing a file
    // that locks the whole estate out, so a NEW one is removed rather than
    // kept; an existing one is left for the operator to inspect against the
    // copy in git rather than silently destroyed.
    if (!existedBefore) unlinkSync(ENCRYPTED_ENV_FILE);
    process.stderr.write(
      '[env] wrote ciphertext that could NOT be decrypted back -- refusing to leave it. ' +
        'Do not commit; check ' + PLAINTEXT_ENV_FILE + ' for content sops cannot round-trip.' + NL,
    );
    return 1;
  }
  if (verified === null) {
    process.stderr.write(
      '[env] wrote ' + ENCRYPTED_ENV_FILE + ' -- NOT verified (no identity on this machine)' + NL,
    );
    return 0;
  }
  process.stderr.write(
    '[env] wrote ' + ENCRYPTED_ENV_FILE + ' and decrypted it back -- commit it' + NL,
  );
  return 0;
}

function recipients(): number {
  if (!existsSync(RECIPIENTS_FILE)) {
    process.stderr.write('[env] ' + RECIPIENTS_FILE + ' not found' + NL);
    return 1;
  }
  const parsed = parseRecipients(readFileSync(RECIPIENTS_FILE, 'utf-8'));
  writeFileSync(SOPS_CONFIG_FILE, renderSopsConfig(parsed));
  process.stderr.write(
    '[env] wrote ' + SOPS_CONFIG_FILE + ' for ' + String(parsed.length) + ' recipient(s)' + NL,
  );
  return 0;
}

function main(): number {
  const cmd = process.argv[2];
  try {
    if (cmd === 'decrypt') return decrypt();
    if (cmd === 'encrypt') return encrypt();
    if (cmd === 'recipients') return recipients();
  } catch (err: unknown) {
    process.stderr.write('[env] ' + formatCliError(err) + NL);
    return 1;
  }
  process.stderr.write('usage: env-bootstrap-cli decrypt | encrypt | recipients' + NL);
  return 1;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) {
  process.exit(main());
}
/* v8 ignore stop */

// scripts/machine-doctor.ts
// PURE CORE for the machine doctor. No I/O: the shell in machine-doctor-cli.ts
// gathers the facts, this file decides what they mean.
//
// WHY THIS EXISTS. Every defect found on 2026-08-15/16 surfaced as a DISGUISED
// RUNTIME FAILURE, discovered mid-task by whoever tripped over it: absent
// pre-commit hooks let a commit made entirely of key material through with zero
// secret scanning; an absent container runtime printed a coverage-FAILED banner
// over an empty log; a Linux-only flock binary masqueraded as a red test suite
// and blocked every push from every Mac; a machine that was not yet an age
// recipient learned so from a refusal in the middle of unrelated work. The
// git merge-driver, documented as run-once-per-clone, has never been surfaced
// by anything at all.
//
// The 2026 answer to this class is a doctor: modular checks, a structured
// pass/fail report, and an ACTIONABLE remediation per finding, run BEFORE the
// work instead of discovered during it.
//
// CAPABILITIES, NOT FILES. The obvious check -- "is there a .env" -- would be
// WRONG and would red-flag a perfectly good machine. This laptop built 13
// workspaces, passed the 90/90/90/90 gate against Testcontainers and shipped
// five PRs to production with no copied .env, because compose.yaml hardcodes
// DATABASE_URL, REDIS_URL and the OIDC trio itself and compose:env generates
// the only values .env must carry. So the question is never "which file is
// missing" but "which capability is unavailable, and why".
//
// THREE STATES, NOT TWO. ready / broken / blocked. The distinction is
// load-bearing: BROKEN is fixable on this machine right now, BLOCKED waits on
// an action only another host can take (the one-time env:encrypt from a machine
// holding the plaintext). Failing the exit code on BLOCKED would make the
// doctor red for days through nobody's fault, and an alarm that is always on is
// an alarm nobody reads -- the same adoption reasoning //#knip documents.

export type CapabilityStatus = 'ready' | 'broken' | 'blocked';

export interface Capability {
  readonly id: string;
  /** What the operator loses while this is not ready. Phrased as an ability,
   *  because that is what a person came here to find out. */
  readonly summary: string;
}

export const CAPABILITIES: readonly Capability[] = Object.freeze([
  Object.freeze({
    id: 'commit-safely',
    summary: 'commit with secret scanning, private-key detection and the CI-mirror gates',
  }),
  Object.freeze({
    id: 'test-locally',
    summary: 'run the full suite and the 90/90/90/90 coverage gate against real containers',
  }),
  Object.freeze({
    id: 'decrypt-env',
    summary: 'materialize the shared secret env from the tracked ciphertext',
  }),
  Object.freeze({
    id: 'merge-generated-files',
    summary: 'merge generated files without hand-resolving meaningless conflicts',
  }),
]);

export interface CheckInput {
  readonly binaries: readonly string[];
  readonly hookTypes: readonly string[];
  readonly containerRuntimeUp: boolean;
  readonly ageIdentityPresent: boolean;
  readonly isRecipient: boolean;
  readonly ciphertextPresent: boolean;
  readonly mergeDriverRegistered: boolean;
}

/** Hook types the repo declares. Kept in sync with bootstrap-machine.ts by the
 *  guard test, rather than by hope. */
const REQUIRED_HOOKS: readonly string[] = Object.freeze(['commit-msg', 'pre-commit', 'pre-push']);

/** Binaries the commit-time guards shell out to. A hook whose binary is absent
 *  fails at commit time with an opaque error, so their absence BREAKS the
 *  capability even when the hooks themselves are installed. */
const COMMIT_BINARIES: readonly string[] = Object.freeze(['pre-commit', 'detect-secrets']);

/** Binaries the env bootstrap shells out to. */
const ENV_BINARIES: readonly string[] = Object.freeze(['sops', 'age']);

function has(list: readonly string[], required: readonly string[]): boolean {
  return required.every((item) => list.includes(item));
}

/** PURE. One capability's verdict from observed facts.
 *
 *  Order inside each capability is deliberate: the condition an operator can
 *  act on comes first, so the remediation printed is the NEXT step rather than
 *  the last one. */
export function capabilityStatus(id: string, input: CheckInput): CapabilityStatus {
  if (id === 'commit-safely') {
    if (!has(input.binaries, COMMIT_BINARIES)) return 'broken';
    if (!has(input.hookTypes, REQUIRED_HOOKS)) return 'broken';
    return 'ready';
  }

  if (id === 'test-locally') {
    // Deliberately independent of every secret: compose.yaml supplies the local
    // service config and Testcontainers provisions its own Postgres.
    return input.containerRuntimeUp ? 'ready' : 'broken';
  }

  if (id === 'decrypt-env') {
    if (!has(input.binaries, ENV_BINARIES)) return 'broken';
    if (!input.ageIdentityPresent) return 'broken';
    if (!input.isRecipient) return 'broken';
    // Last, and BLOCKED rather than broken: nothing done on this machine can
    // produce the ciphertext. It needs one env:encrypt from a host that holds
    // the plaintext.
    if (!input.ciphertextPresent) return 'blocked';
    return 'ready';
  }

  if (id === 'merge-generated-files') {
    return input.mergeDriverRegistered ? 'ready' : 'broken';
  }

  // An unknown id is a programming error, not a machine fault. Fail closed so a
  // capability added to the list without a rule cannot silently report ready.
  return 'broken';
}

/** PURE. The exact command that closes the gap. Never prose: an operator with a
 *  broken machine wants something to paste, and a report without a fix is a
 *  complaint. */
export function remediationFor(id: string): string {
  const fixes: Readonly<Record<string, string>> = {
    'commit-safely':
      'brew install pre-commit detect-secrets, then pnpm exec turbo run bootstrap:machine',
    'test-locally':
      'start Docker Desktop (open -a Docker) and wait for the daemon; the estate runs Docker Desktop only, deliberately, so every machine matches',
    'decrypt-env':
      'brew install sops age, then age-keygen -o ~/.config/sops/age/keys.txt and send the PUBLIC key to the repo owner for .age-recipients; finally pnpm exec turbo run env:decrypt',
    'merge-generated-files': 'pnpm exec turbo run git:merge-drivers',
  };
  return fixes[id] ?? 'no remediation registered for ' + id;
}

export interface Finding {
  readonly id: string;
  readonly summary: string;
  readonly status: CapabilityStatus;
  readonly remediation: string;
}

/** PURE. Every capability, always, in declaration order. Reporting only the
 *  failures would hide the list itself, and a gap you cannot see is the exact
 *  failure mode this tool exists to end. */
export function diagnose(input: CheckInput): readonly Finding[] {
  return CAPABILITIES.map((capability) => {
    const status = capabilityStatus(capability.id, input);
    return Object.freeze({
      id: capability.id,
      summary: capability.summary,
      status,
      remediation: status === 'ready' ? '' : remediationFor(capability.id),
    });
  });
}

/** PURE. Exit non-zero ONLY for what this machine can fix. BLOCKED is reported
 *  loudly and exits 0: failing on another host's pending action would keep the
 *  doctor red for days and train the operator to ignore it. */
export function overallExit(findings: readonly Finding[]): number {
  return findings.some((f) => f.status === 'broken') ? 1 : 0;
}

// scripts/estate-verify.ts
// Pure core: decide whether the worktree estate is CLEAN, and say why when it
// is not.
//
// WHY THIS EXISTS. Verifying the estate was three commands read by human eyes
// -- `git worktree list`, `git stash list`, `git status --porcelain` -- which is
// the shape worktree:close describes retiring: "a hand-rolled git idiom, not a
// captured op". It also nearly shipped a false report: the SWEEP's `unmerged`
// refusal, not those three commands, is what revealed PR #565 was still OPEN
// after it had been summarised as deployed.
//
// FOUR PROPERTIES, not three. `git worktree list --porcelain` also reports
// `prunable` ("gitdir file points to non-existent location") and `locked`. A
// stale worktree is a real defect -- GitLab records that "git 2.16 will fail
// badly if there are stale worktrees" -- and the hand check could not see one.
//
// AXIS 1: this shape crosses a TRUST BOUNDARY. Every field is derived from git
// subprocess output, so the schema is the SSOT and the driver PARSES into it
// rather than assembling an object literal and asserting a TypeScript type. A
// hand-written interface would let the shell hand this core a shape no
// production path could produce, and the type would agree.
//
// The factory parses too, so a fixture that stops satisfying the contract fails
// AT CONSTRUCTION rather than in whichever test notices first. Co-located with
// the schema for the reason close-worktree.ts states: a new field is defaulted
// in ONE place, never a shotgun edit across test files. Fixture drift is not
// hypothetical here -- admin-drivers-client fixtures omitted six required
// fields and passed only because the call site cast instead of parsing.
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';

/** One worktree, as observed from git. Parsed at the boundary, never cast. */
// strictObject, not object: this literal is assembled by gatherOne from git
// output, so an unrecognised key means OUR OWN typo -- writing stashcount for
// stashCount would otherwise be stripped in silence and read as 0, the exact
// failure the MCP SDK records as "parameter name typos are silently dropped".
// Deliberately the OPPOSITE choice from AdminDriverRowSchema, which is
// looseObject because it parses a PRODUCER wire format where a newer server may
// legitimately add fields. Same library, different boundary, different mode.
// z.strictObject is the Zod 4 form; .strict() still works but is no longer
// preferred.
export const WorktreeStateSchema = z.strictObject({
  // Git always reports an ABSOLUTE path here. Requiring one is not decoration:
  // this value becomes the `cwd` of subsequent git calls, so a relative or
  // control-character path signals a PARSE failure, not a worktree, and must
  // never reach a subprocess. A newline is the sharp case -- porcelain output
  // is line-oriented, so a path containing one silently desynchronises the
  // parse (git escapes and quotes such characters, and offers -z precisely
  // because of it). Injection itself is already closed one layer down: every
  // call is execFileSync with an argv ARRAY and no shell, which is the
  // documented single-API fix. This is defence in depth on top of that.
  path: z.string().min(1)
    .refine((v) => v.startsWith('/'), 'worktree path must be absolute')
    .refine(
      // CANONICAL FORM, enforced at the boundary. A path carrying .. segments or a
      // trailing slash denotes the same worktree yet compares unequal, and 2026
      // guidance is explicit that canonicalisation must precede validation --
      // sanitising raw strings is how every traversal bypass works. t96 fixed the
      // identical bug in worktree:close, where a literal string compare against
      // porcelain output (always absolute) refused a valid target.
      //
      // Confinement to an "estate root" is deliberately NOT added: worktrees
      // legitimately live outside the repo -- this one is a SIBLING of the clone --
      // so a root check would reject every real path. git worktree list IS the
      // allowlist, and a second one would compete with it.
      (v) => v === resolve(v),
      'worktree path must already be canonical',
    )
    .refine(
      // A PREDICATE, not a regex. eslint's no-control-regex is right that a
      // control character inside a pattern is usually accidental, and a
      // suppression would be the treadmill answer -- but the rule is also right
      // that a regex reads poorly for this intent. Checking code points states
      // exactly what is meant and needs no exception.
      (v) => {
        // Indexed charCodeAt, NOT a spread or split(''). The lint rule is right
        // that both mishandle rich characters -- but that concern is about
        // DECOMPOSING text, and this asks a different question: does any UTF-16
        // code unit fall in the control range. Every control character lives in
        // the BMP, so a surrogate half can never be mistaken for one, and the
        // check is exact without needing an exception.
        for (let i = 0; i < v.length; i += 1) {
          const code = v.charCodeAt(i);
          if (code < 0x20 || code === 0x7f) return false;
        }
        return true;
      },
      'worktree path must not contain control characters',
    ),
  branch: z.string(),
  dirtyFileCount: z.number().int().nonnegative(),
  aheadOfRemote: z.number().int().nonnegative(),
  stashCount: z.number().int().nonnegative(),
  prunable: z.boolean(),
  locked: z.boolean(),
}).brand<"WorktreeState">();
// BRANDED, so the type cannot be produced by writing an object literal. The
// schema is the only constructor: a raw shape from JSON.parse or a hand-built
// mock no longer satisfies WorktreeState, so "the driver forgot to parse"
// becomes a COMPILE error instead of a runtime hazard.
//
// This is deliberately NOT a re-parse inside classifyEstate. Validating already
// trusted internal data in every helper is the redundant-validation
// anti-pattern the two-axis rule names, and eas-build-freshness states it
// outright: "re-parsing already trusted internal data inside every helper is
// the anti-pattern that boundary exists to prevent". Branding moves the
// guarantee to the type system instead of paying for it on every call.
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/** Why one worktree is not clean. Codes, never prose: callers branch on these
 *  and the operator report is derived from them. */
export const ESTATE_REASONS = [
  'dirty',
  'unpushed',
  'stash',
  'prunable',
  'locked',
] as const;
export type EstateReason = (typeof ESTATE_REASONS)[number];

/** One unclean worktree, as reported. Cross-boundary: it is emitted inside
 *  body.problems and parsed by agents, so the SCHEMA is the SSOT and the type
 *  derives from it. It was previously hand-written beside an inline strictObject
 *  in the event schema -- the same shape declared twice.
 *
 *  .readonly() so the inferred arrays match how the core builds them; without
 *  it z.infer yields a mutable array and a readonly source will not assign. */
export const EstateProblemSchema = z.strictObject({
  path: z.string(),
  branch: z.string(),
  reasons: z.array(z.enum(ESTATE_REASONS)).readonly(),
}).readonly();
export type EstateProblem = z.infer<typeof EstateProblemSchema>;


/** A DISCRIMINATED verdict, so an invalid combination cannot be built.
 *
 *  The previous shape was { clean: boolean; checked; problems }, which admits
 *  `clean: true` alongside a non-empty problems array -- a state the type
 *  system permitted and nothing in the domain could ever mean. Splitting the
 *  variants and typing the dirty arm's problems as a NON-EMPTY tuple makes both
 *  contradictions unrepresentable rather than merely unlikely.
 *
 *  The event is deliberately NOT embedded here. It is DERIVED from this
 *  verdict, and storing a derivation beside its source admits a verdict whose
 *  event disagrees with its own fields -- the duplicate-data hazard SSOT
 *  guidance describes. It would also force the domain to construct a
 *  presentation artifact, which the layering guard forbids. */
export type EstateVerdict =
  | {
      readonly clean: true;
      readonly checked: number;
      readonly problems: readonly [];
    }
  | {
      readonly clean: false;
      readonly checked: number;
      readonly problems: readonly [EstateProblem, ...EstateProblem[]];
    };

/** Test-fixture factory. Overrides are applied BEFORE parsing, so an override
 *  that violates the contract throws instead of producing a state no git output
 *  could ever yield. Default is the CLEAN baseline, so each test overrides only
 *  the dimension it exercises. */
export function createWorktreeState(
  overrides: Partial<WorktreeState> = {},
): WorktreeState {
  return WorktreeStateSchema.parse({
    path: '/c/t1-wt1-fixture',
    branch: 'feat/fixture',
    dirtyFileCount: 0,
    aheadOfRemote: 0,
    stashCount: 0,
    prunable: false,
    locked: false,
    ...overrides,
  });
}

/** Every reason at once, in a stable order. A report that stops at the first
 *  problem sends the operator round the loop once per problem -- the sibling
 *  failure GitLab records, where a cleanup returned "only the error code ...
 *  which made it difficult to diagnose". */
export function reasonsFor(state: WorktreeState): readonly EstateReason[] {
  const reasons: EstateReason[] = [];
  if (state.dirtyFileCount > 0) reasons.push('dirty');
  if (state.aheadOfRemote > 0) reasons.push('unpushed');
  if (state.stashCount > 0) reasons.push('stash');
  if (state.prunable) reasons.push('prunable');
  if (state.locked) reasons.push('locked');
  return reasons;
}

/** Pure verdict over the whole estate. An EMPTY estate is clean, not an error:
 *  a fresh clone with no linked worktrees is a legitimate state. The DRIVER,
 *  not this function, is responsible for failing closed when git cannot be
 *  read at all -- an unreadable estate must never reach here looking empty. */
export function classifyEstate(states: readonly WorktreeState[]): EstateVerdict {
  const problems: EstateProblem[] = [];
  for (const s of states) {
    const reasons = reasonsFor(s);
    if (reasons.length > 0) {
      problems.push({ path: s.path, branch: s.branch, reasons });
    }
  }
  // Destructured, never cast: `first` proves the array is non-empty to the
  // compiler, so the dirty arm is constructed without asserting anything.
  const [first, ...rest] = problems;
  return first === undefined
    ? { clean: true, checked: states.length, problems: [] }
    : { clean: false, checked: states.length, problems: [first, ...rest] };
}

/** Operator report. Names the worktree AND every reason, and on success states
 *  HOW MANY were checked -- a bare "OK" cannot be told apart from a run that
 *  examined nothing, which is the confident-zero hazard stack:stop and
 *  docker:reclaim both guard. */
export function describeEstate(v: EstateVerdict): string {
  const nl = String.fromCharCode(10);
  if (v.clean) {
    return 'estate clean: ' + String(v.checked) + ' worktree(s) checked, ' +
      'no dirty tree, no unpushed commits, no stash, none stale or locked';
  }
  const lines = v.problems.map(
    (p) => '  ' + p.path + ' [' + p.branch + '] (' + p.reasons.join(',') + ')',
  );
  return 'estate NOT clean: ' + String(v.problems.length) + ' of ' +
    String(v.checked) + ' worktree(s)' + nl + lines.join(nl);
}

/** Machine-readable verdict. STRUCTURED TRUTH, emitted alongside the prose and
 *  DERIVED FROM THE SAME VERDICT -- never parsed back out of the sentence.
 *
 *  describeEstate alone made an orchestrator read English to learn whether the
 *  estate was clean, which is the failure gate:agent already names: it emits
 *  NDJSON per state transition precisely so a consumer never scrapes stdout.
 *  eas-build-freshness.ts states the same rule for its own verdict -- "machine
 *  consumers read these fields; the prose below is derived from the same
 *  verdict rather than being parsed by anything".
 *
 *  reasons is a flat, sorted, de-duplicated set of the CODES present across the
 *  estate, so a consumer can route on `dirty` or `prunable` without walking the
 *  per-worktree array; problems keeps the per-worktree detail for a human. */
/** OpenTelemetry Events shape, not an ad-hoc flat object.
 *
 *  event.name is NAMESPACED and low-cardinality: the spec requires names be
 *  part of a namespace, forbids dynamic values in them, and treats the name as
 *  the identifier of the payload STRUCTURE. A bare "estate_verified" collides
 *  the moment any other tool emits one.
 *
 *  ATTRIBUTES hold only queryable scalars; the unbounded per-worktree detail
 *  lives in BODY. The spec is explicit: avoid attributes with potentially
 *  unbounded values, and record those in the event body instead -- backends do
 *  not index inside complex attributes, so putting a 45-element array there
 *  makes it expensive and unqueryable at once.
 *
 *  Snake_case attribute keys follow the convention used throughout semconv
 *  (gen_ai.usage.input_tokens and friends). */

export function estateTelemetry(
  v: EstateVerdict,
  trace: SpanContext | null = null,
  digest: string | null = null,
  sourceDigest: string | null = null,
): EstateTelemetry {
  const seen = new Set<EstateReason>();
  for (const p of v.problems) {
    for (const r of p.reasons) seen.add(r);
  }
  // Declaration order, not insertion order: a consumer diffing two runs must
  // not see a change because the estate happened to be walked differently.
  const reasons = ESTATE_REASONS.filter((r) => seen.has(r));
  return {
    "event.name": "fleet.estate.verified",
    schema_version: ESTATE_SCHEMA_VERSION,
    ...severityFor(v),
    ...(trace ?? {}),
    ...(digest === null ? {} : { estate_digest: digest }),
    ...(sourceDigest === null ? {} : { source_digest: sourceDigest }),
    attributes: {
      clean: v.clean,
      checked: v.checked,
      unclean_count: v.problems.length,
      reasons,
      kinds: kindsFor(reasons),
    },
    body: { problems: v.problems },
  };
}

/** Parse one raw record into a WorktreeState, or null.
 *
 *  safeParse, NEVER parse. The driver previously called
 *  WorktreeStateSchema.parse inside its gather loop, so a record git produced
 *  that the schema rejects -- a future porcelain change, an unusual path, a
 *  marker line this parser mis-splits -- threw an uncaught ZodError. That is
 *  strictly worse than it sounds: the contract is EXACTLY ONE NDJSON event on
 *  stdout, and an uncaught throw emits a stack trace to stderr and NO event, so
 *  the fail-closed guarantee disappears in the one case it exists for.
 *
 *  2026 practice is explicit -- "throwing uncaught errors from validation is a
 *  sign of poor error handling"; parse suits trusted internal flows, safeParse
 *  suits untrusted input a caller must handle without crashing. Subprocess
 *  output is the second kind.
 *
 *  Returns null rather than a partial state: a half-parsed worktree would be a
 *  guess, and guessing here means reporting a verdict about a worktree we could
 *  not actually read. The caller escalates to the unreadable verdict. */
export function toWorktreeState(raw: unknown): WorktreeState | null {
  const parsed = WorktreeStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** OTel severity for a verdict. SeverityText and SeverityNumber are part of the
 *  Logs Data Model precisely so severity does not have to be re-derived from
 *  payload fields by every consumer -- a router should not need to know that
 *  `clean:false` means "warn". Numbers follow the spec's ranges: INFO 9,
 *  WARN 13, ERROR 17. */
/** The severity vocabulary, as const for the same reason REASON_KINDS is: one
 *  declaration serves the type and the runtime schema, so a new level cannot
 *  exist in the type while the validator still rejects it. Numbers follow the
 *  OTel ranges -- INFO 9, WARN 13, ERROR 17. */
export const SEVERITY_TEXTS = ['INFO', 'WARN', 'ERROR'] as const;
export const SEVERITY_NUMBERS = [9, 13, 17] as const;

export interface EstateSeverity {
  readonly severity_text: (typeof SEVERITY_TEXTS)[number];
  readonly severity_number: (typeof SEVERITY_NUMBERS)[number];
}

export function severityFor(v: EstateVerdict, readable = true): EstateSeverity {
  // Unreadable outranks unclean: a verdict we could not compute is a tooling
  // failure, while a dirty worktree is a normal working state.
  if (readable) {
    return v.clean
      ? { severity_text: "INFO", severity_number: 9 }
      : { severity_text: "WARN", severity_number: 13 };
  }
  return { severity_text: "ERROR", severity_number: 17 };
}

/** W3C trace context, INHERITED not invented.
 *
 *  A trace_id this process generates for itself correlates nothing -- there is
 *  one event and one run. It becomes useful only when a PARENT supplies it, so
 *  an orchestrator can tie this verdict to the run that asked for it. That is
 *  what the W3C traceparent header is for, and gate:agent already carries one
 *  per state transition for the same reason.
 *
 *  Format: version-traceid-spanid-flags, e.g.
 *  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *  Returns null when absent or malformed rather than fabricating an id: a
 *  fabricated correlation id is worse than none, because it looks like
 *  provenance and carries none.
 */
export interface TraceContext {
  readonly trace_id: string;
  readonly span_id: string;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function traceContextFrom(raw: string | undefined): TraceContext | null {
  if (raw === undefined) return null;
  const m = TRACEPARENT.exec(raw.trim());
  if (m === null) return null;
  const [, traceId, spanId] = m;
  if (traceId === undefined || spanId === undefined) return null;
  // All-zero ids are explicitly invalid in the W3C spec.
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { trace_id: traceId, span_id: spanId };
}

/** sha256 of any text, hex. Shared so the snapshot digest and the source
 *  digest are provably the same function -- two hashes computed two ways is a
 *  discrepancy waiting to be misread. */
export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Content-addressable digest of the estate SNAPSHOT.
 *
 *  Lets a consumer say "this is the state I acted on" and re-derive it later,
 *  and distinguishes an unchanged estate from one that changed and changed
 *  back -- which a timestamp cannot.
 *
 *  DETERMINISM IS THE WHOLE VALUE, so the input is normalised before hashing:
 *  entries are sorted by path, and each is serialised with a FIXED field order
 *  rather than JSON.stringify over the object, whose key order follows
 *  insertion and would make the digest depend on how the driver happened to
 *  build the literal.
 *
 *  NOT SIGNED, deliberately. A local tool signing its own output with a key it
 *  holds proves nothing: signer and verifier are the same principal, so anyone
 *  who can run the tool can forge the attestation. 2026 guidance is explicit
 *  that a signing identity "should not be accessible to the build script", and
 *  keyless signing needs an ambient OIDC identity that exists in CI and not on
 *  a laptop. Signing belongs there, as its own arc. A digest still gives
 *  integrity against accidental drift, which is the failure actually reachable
 *  here. */
export function estateDigest(states: readonly WorktreeState[]): string {
  const lines = [...states]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((s) => [
      s.path, s.branch, String(s.dirtyFileCount), String(s.aheadOfRemote),
      String(s.stashCount), String(s.prunable), String(s.locked),
    ].join('\u0000'));
  return digestOf(lines.join("\u0001"));
}

/** What KIND of problem a reason is, because the two kinds have different
 *  owners and different remediations.
 *
 *  work-in-progress -- dirty, unpushed, stash. The operator has work in flight
 *  and the fix is to finish it: commit, push, pop. No tool should act on these,
 *  and worktree:close already refuses on every one of them.
 *
 *  structural -- prunable, locked. The worktree itself is defective or
 *  deliberately held: prunable means the gitdir points nowhere and
 *  `git worktree prune` repairs it, while locked means someone locked it on
 *  purpose and unlocking needs their reason, not a sweep.
 *
 *  A router previously had to hardcode the reason list to tell these apart.
 *  Declared as a TOTAL Record, so adding a reason without classifying it is a
 *  compile error -- the discipline check-conclusion.ts uses for its verdict
 *  table. */
export type ReasonKind = (typeof REASON_KINDS)[number];

export const REASON_KIND: Record<EstateReason, ReasonKind> = {
  dirty: 'work-in-progress',
  unpushed: 'work-in-progress',
  stash: 'work-in-progress',
  prunable: 'structural',
  locked: 'structural',
};

/** The kind vocabulary, as const so ONE declaration serves the type, the
 *  ordering, and the runtime schema. Hand-listing these in the event schema
 *  would let ReasonKind gain a value the validator never learns about. */
export const REASON_KINDS = ['work-in-progress', 'structural'] as const;

/** The kinds present across an estate, in declaration order and de-duplicated,
 *  so a consumer branches on TWO values rather than learning five reasons. */
export function kindsFor(reasons: readonly EstateReason[]): readonly ReasonKind[] {
  const seen = new Set(reasons.map((r) => REASON_KIND[r]));
  return REASON_KINDS.filter((k) => seen.has(k));
}

/** Why the estate could not be read. Codes, so a router acts without parsing
 *  prose: git-failed means the subprocess itself failed; no-records means git
 *  exited 0 yet produced no worktree, which cannot happen in a valid repo;
 *  record-rejected means a record did not satisfy the schema. */
export const UNREADABLE_REASONS = [
  'git-failed',
  'no-records',
  'record-rejected',
] as const;
export type UnreadableReason = (typeof UNREADABLE_REASONS)[number];

/** A DISTINCT event, not the verified event with awkward values.
 *
 *  Both previously carried event.name "fleet.estate.verified", so a consumer
 *  told them apart by inferring from `clean:false, checked:0` -- the
 *  optional-properties bag the discriminated-union guidance warns about, where
 *  an invalid combination is representable and "unclean with zero problems"
 *  reads the same as "could not read". OTel says the same thing from the other
 *  side: an event name identifies a payload STRUCTURE, so a different structure
 *  needs a different name.
 *
 *  It also carries WHICH failure occurred. Three call sites previously emitted
 *  an identical payload, so the event could not distinguish a failed subprocess
 *  from an empty parse from a rejected record. */

/** The closed set of events this task emits. event.name is the discriminant. */
export type EstateEvent =
  | EstateTelemetry
  | EstateUnreadableEvent
  | EstateStaleEvent;

export function unreadableEstateEvent(
  reason: UnreadableReason,
  trace: SpanContext | null = null,
  sourceDigest: string | null = null,
): EstateUnreadableEvent {
  return {
    'event.name': 'fleet.estate.unreadable',
    schema_version: ESTATE_SCHEMA_VERSION,
    severity_text: 'ERROR',
    severity_number: 17,
    ...(trace ?? {}),
    ...(sourceDigest === null ? {} : { source_digest: sourceDigest }),
    attributes: { reason },
  };
}

/** What the gather step LEARNED, as a closed set.
 *
 *  The driver's three fail-closed paths were decided inline in mainEstateVerify,
 *  which lives under a v8-ignore because it spawns git -- so "git threw, so emit
 *  git-failed and exit 3" was verified by reading the code and nothing else.
 *  2026 practice for subprocess-bearing CLIs is to move the instantiation up a
 *  level and make the INTERACTION the part under test, which is the split
 *  decideClose and decideMergeReady already use in this repo. */
export type EstateGathered =
  | { readonly kind: 'git-failed' }
  | { readonly kind: 'no-records'; readonly sourceDigest: string }
  | { readonly kind: 'record-rejected'; readonly sourceDigest: string }
  | {
      readonly kind: 'states';
      readonly states: readonly WorktreeState[];
      readonly sourceDigest: string;
    };

/** A DISCRIMINATED decision, so a verdict exists exactly when there is one.
 *
 *  It previously paired `event: EstateEvent` with `verdict: EstateVerdict |
 *  null` as INDEPENDENT fields, which is the conflicting-flags shape: nothing
 *  tied them together, so the driver needed a "verdict missing for a verified
 *  event" branch that could never run. That is the defensive "should never
 *  happen" comment the make-illegal-states-unrepresentable literature names --
 *  easy to miss, easy to delete, and costly to test.
 *
 *  Splitting the variants deletes the branch instead of documenting it, and
 *  lets estateLine be exhaustive without a fallback.
 *
 *  exitCode is narrowed PER VARIANT, so 3 belongs to unreadable and 4 to stale
 *  by construction rather than by convention. */
export type EstateDecision =
  | {
      readonly kind: 'unreadable';
      readonly event: EstateUnreadableEvent;
      readonly exitCode: 3;
    }
  | {
      readonly kind: 'stale';
      readonly event: EstateStaleEvent;
      readonly exitCode: 4;
    }
  | {
      readonly kind: 'verified';
      readonly event: EstateTelemetry;
      readonly verdict: EstateVerdict;
      readonly exitCode: 0 | 1;
    };

function unreachable(x: never): never {
  throw new Error('unhandled gather outcome: ' + JSON.stringify(x));
}

/** The whole decision, pure. Takes what was learned, returns what to emit and
 *  what to exit with. No git, no stdout, no clock. */
export function decideEstate(
  g: EstateGathered,
  trace: SpanContext | null = null,
  expectDigest: string | null = null,
): EstateDecision {
  switch (g.kind) {
    case 'git-failed':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent('git-failed', trace),
        exitCode: 3,
      };
    case 'no-records':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent('no-records', trace, g.sourceDigest),
        exitCode: 3,
      };
    case 'record-rejected':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent('record-rejected', trace, g.sourceDigest),
        exitCode: 3,
      };
    case 'states': {
      const actual = estateDigest(g.states);
      // COMPARE-AND-SWAP, before any verdict is reported: a caller that pinned a
      // digest is asking to act only on THAT estate, and reporting a verdict
      // for a different one is the lost-update the check exists to prevent.
      if (expectDigest !== null && expectDigest !== actual) {
        return {
          kind: 'stale',
          event: estateStaleEvent(expectDigest, actual, trace),
          exitCode: 4,
        };
      }
      const verdict = classifyEstate(g.states);
      return {
        kind: 'verified',
        event: estateTelemetry(verdict, trace, actual, g.sourceDigest),
        exitCode: verdict.clean ? 0 : 1,
        verdict,
      };
    }
    default:
      return unreachable(g);
  }
}

/** The estate moved between the read and the act.
 *
 *  estate_digest let a caller RECORD what it observed; nothing let it BIND an
 *  action to that observation. The caller had to re-run, re-parse, and compare
 *  digests itself -- and a check the caller performs separately from the act is
 *  exactly the split compare-and-swap exists to close: in this repo two laptops
 *  and many worktrees mutate the estate concurrently, so a plan made at digest
 *  X can be executed against a world already at Y.
 *
 *  This is the If-Match / 412 Precondition Failed shape, value-based rather
 *  than a version counter or timestamp: the digest IS the content, so it cannot
 *  drift from what it describes.
 *
 *  A DISTINCT event, because it is neither a verdict nor an unreadable estate.
 *  The estate was read perfectly well -- it simply is not the one the caller
 *  planned against, and the remediation is to re-read and re-plan rather than
 *  to fix a worktree or a tool. */

export function estateStaleEvent(
  expectedDigest: string,
  actualDigest: string,
  trace: SpanContext | null = null,
): EstateStaleEvent {
  return {
    'event.name': 'fleet.estate.stale',
    schema_version: ESTATE_SCHEMA_VERSION,
    // WARN, not ERROR: nothing is broken. The caller's view is simply out of
    // date, which is a normal outcome in a concurrent estate and is recovered
    // by re-reading, exactly as a 412 is.
    severity_text: 'WARN',
    severity_number: 13,
    ...(trace ?? {}),
    attributes: { expected_digest: expectedDigest, estate_digest: actualDigest },
  };
}

/** Schema version, carried on EVERY event this task emits.
 *
 *  event.name says WHICH event; this says which REVISION of that event's
 *  payload, which a name cannot express. Without it a consumer cannot tell a
 *  field it does not recognise from a field that was removed, and 2026 guidance
 *  lists publishing different shapes of the same event without a version among
 *  the practices to avoid outright -- "impossible to debug".
 *
 *  Not hypothetical here: this arc already made a breaking change, moving the
 *  unreadable case off fleet.estate.verified onto its own name and shape. A
 *  consumer written against the earlier form would have broken with no signal.
 *
 *  SEMVER, and the rules are the usual ones: PATCH for documentation or
 *  metadata, MINOR for a backward-compatible addition such as a new optional
 *  attribute, MAJOR for anything a existing reader could misinterpret -- a
 *  removed field, a narrowed enum, or the same field meaning something new.
 *  A changed MEANING is major even when the shape is identical.
 *
 *  ONE constant, referenced by all three variants, so a bump cannot land on
 *  some events and miss others. */
export const ESTATE_SCHEMA_VERSION = '1.0.0';
export type EstateSchemaVersion = typeof ESTATE_SCHEMA_VERSION;

/** RUNTIME schema for everything this task emits.
 *
 *  The events are the published contract: they carry schema_version and an
 *  agent parses them. They were hand-written interfaces with no runtime
 *  artifact, so nothing executable connected what we DECLARE to what we EMIT,
 *  and nothing forced a version bump when the shape changed. 2026 guidance is
 *  to make that relationship executable -- a contract assertion so a schema and
 *  its validator cannot drift silently, failing the build rather than a live
 *  run.
 *
 *  Discriminated on event.name, matching the union it validates, so a parse
 *  failure names WHICH variant disagreed rather than reporting a vague union
 *  mismatch.
 *
 *  strictObject throughout: an unrecognised key in an event WE construct is our
 *  own typo, the same argument WorktreeStateSchema makes. */
const EventBaseShape = {
  schema_version: z.literal(ESTATE_SCHEMA_VERSION),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  // The span this run was a CHILD of. Present whenever a parent supplied a
  // traceparent, so a collector can nest this task under the run that invoked it.
  parent_span_id: z.string().optional(),
} as const;

export const EstateTelemetrySchema = z.strictObject({
  'event.name': z.literal('fleet.estate.verified'),
  ...EventBaseShape,
  severity_text: z.enum(SEVERITY_TEXTS),
  severity_number: z.union([z.literal(9), z.literal(13), z.literal(17)]),
  // Literals, not z.enum: z.enum is string-only. The union mirrors
  // SEVERITY_NUMBERS, and the guard test below proves they agree.
  estate_digest: z.string().optional(),
  source_digest: z.string().optional(),
  attributes: z.strictObject({
    clean: z.boolean(),
    checked: z.number().int().nonnegative(),
    unclean_count: z.number().int().nonnegative(),
    reasons: z.array(z.enum(ESTATE_REASONS)).readonly(),
    kinds: z.array(z.enum(REASON_KINDS)).readonly(),
  }),
  body: z.strictObject({
    problems: z.array(EstateProblemSchema).readonly(),
  }),
});

export const EstateUnreadableEventSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.unreadable'),
  ...EventBaseShape,
  severity_text: z.literal('ERROR'),
  severity_number: z.literal(17),
  source_digest: z.string().optional(),
  attributes: z.strictObject({ reason: z.enum(UNREADABLE_REASONS) }),
});

export const EstateStaleEventSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.stale'),
  ...EventBaseShape,
  severity_text: z.literal('WARN'),
  severity_number: z.literal(13),
  attributes: z.strictObject({
    expected_digest: z.string(),
    estate_digest: z.string(),
  }),
});

export const EstateEventSchema = z.discriminatedUnion('event.name', [
  EstateTelemetrySchema,
  EstateUnreadableEventSchema,
  EstateStaleEventSchema,
]);

/** The event types, DERIVED from the schemas above rather than hand-written
 *  beside them.
 *
 *  They were interfaces declaring the same cross-boundary shapes the schemas
 *  declare -- one contract, two definitions, which is the duplication the
 *  schema-first rule forbids. Nine tests existed to prove the two agreed; with
 *  a single declaration there is nothing left to disagree.
 *
 *  Axis 1 is unchanged: these are values WE construct, so nothing re-parses
 *  them in production. The schemas exist because the shape crosses a boundary
 *  (agents parse the NDJSON) and because tests assert what we emit matches what
 *  we publish -- not to re-validate trusted internal data. */
export type EstateTelemetry = z.infer<typeof EstateTelemetrySchema>;
export type EstateUnreadableEvent = z.infer<typeof EstateUnreadableEventSchema>;
export type EstateStaleEvent = z.infer<typeof EstateStaleEventSchema>;

/** A span of our own, inside the caller's trace.
 *
 *  traceContextFrom returns what the PARENT sent, and every event copied that
 *  span_id verbatim -- so these events claimed to belong to the parent's span
 *  and this task never appeared as an operation of its own. W3C is explicit
 *  that a child generates a NEW span id and records the received one as its
 *  parent; copying it upward is how a trace ends up with a hole exactly where
 *  the work happened.
 *
 *  OTel's CLI semantic conventions cover precisely this shape -- short-lived
 *  programs that end their execution -- with span kind INTERNAL and an error
 *  status when the exit code is non-zero. The events carry the ids rather than
 *  a span-event API, because OTel deprecated span events in March 2026 in
 *  favour of "events as logs correlated with the current span".
 *
 *  No SDK, no exporter, no collector dependency: a short-lived CLI that stands
 *  up an OTLP pipeline to emit one span pays startup and network cost for a
 *  process measured in milliseconds, which is the over-instrumentation the
 *  guidance warns against. Emitting correct ids on the NDJSON lets a collector
 *  that already reads this stream assemble the span.
 *
 *  randomBytes, not Math.random: span ids must not collide across concurrent
 *  runs, and two laptops sweeping the same estate run this task simultaneously. */
export interface SpanContext {
  readonly trace_id: string;
  readonly span_id: string;
  readonly parent_span_id?: string;
}

/** 8 bytes hex, per W3C. Never all-zero, which the spec calls invalid. */
export function newSpanId(rand: () => Buffer = () => randomBytes(8)): string {
  const id = rand().toString('hex');
  return /^0+$/.test(id) ? '0'.repeat(15) + '1' : id;
}

/** Build this run's span context: same trace as the parent when one was
 *  supplied, a fresh span either way, and the parent recorded when present. */
export function spanContextFor(
  parent: TraceContext | null,
  newId: () => string = newSpanId,
): SpanContext | null {
  if (parent === null) return null;
  return {
    trace_id: parent.trace_id,
    span_id: newId(),
    parent_span_id: parent.span_id,
  };
}

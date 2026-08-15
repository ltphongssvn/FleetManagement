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
import { EstateActionSchema, actionForVerdict, exitCodeFor } from './estate-action.js';
import {
  ESTATE_REASONS,
  EstateProblemSchema,
  REASON_KIND,
  REASON_KINDS,
  kindsFor,
  reasonsAcross,
  type EstateProblem,
  type EstateReason,
  type ReasonKind,
} from './estate-vocabulary.js';

// RE-EXPORTED, not re-declared. The vocabulary lives in the leaf so this module
// and estate-action.ts can both read it without importing each other; every
// existing consumer still resolves these names from here.
export {
  ESTATE_REASONS,
  EstateProblemSchema,
  REASON_KIND,
  REASON_KINDS,
  kindsFor,
  reasonsAcross,
  type EstateProblem,
  type EstateReason,
  type ReasonKind,
};

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
  // NO CONTROL CHARACTERS, for the same reason path forbids them, and NOT
  // symmetry for its own sake. This value is interpolated RAW into the
  // operator sentence and written to stderr, so an ESC byte reaches a terminal
  // unescaped. stdout happens to be safe because JSON.stringify escapes
  // control bytes -- but relying on a serialiser's incidental behaviour is not
  // a defence, and the prose path has no serialiser at all.
  //
  // 2026 has a run of CVEs in exactly this class: unescaped filenames in
  // scanner output, log output in gh run view, and command injection through a
  // BRANCH NAME, which is attacker-controllable in any shared repository.
  // CWE-150. Git's own check-ref-format already forbids control bytes in ref
  // names, so this is defence in depth on top of that -- the identical
  // argument the path refinement makes.
  //
  // The concealment case is the one that matters for an agent: rendering hides
  // these bytes from a person while a model reads the raw text.
  branch: z.string().refine(
    (v) => {
      for (let i = 0; i < v.length; i += 1) {
        const code = v.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    },
    'branch must not contain control characters',
  ),
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
  // SORTED BY PATH, matching estateDigest's normalisation. The loop above walks
  // states in git's listing order, so an unchanged estate could yield the same
  // estate_digest (which sorts) while body.problems came out ordered
  // differently -- and a consumer diffing two events would see a change that
  // never happened. This is the same rule already applied to `reasons`:
  // declaration order, never walk order.
  problems.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

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
  // REQUIRED, no default. A verdict is always ABOUT a specific snapshot, and
  // the recommendation this event carries is derived from that snapshot alone.
  // A nullable digest let a caller build a verdict whose evidence could not be
  // named, which is an action no downstream PDP could re-verify.
  digest: Digest,
  // The instant, INJECTED. An audit record needs a timestamp, and a pure core
  // must not read a clock -- so the shell supplies it and a test pins it.
  timestamp: string,
  sourceDigest: Digest | null = null,
): EstateTelemetry {
  const reasons = reasonsAcross(v.problems);
  return {
    "event.name": "fleet.estate.verified",
    schema_version: ESTATE_SCHEMA_VERSION,
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: actionForVerdict(reasons),
    ...severityFor(v),
    ...(trace ?? {}),
    estate_digest: digest,
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
export const SEVERITY_TEXTS = Object.freeze(['INFO', 'WARN', 'ERROR'] as const);
export const SEVERITY_NUMBERS = Object.freeze([9, 13, 17] as const);

/** SCHEMA-FIRST. This was a hand-written interface paralleling the severity
 *  fields already declared in the event schemas, and the numeric union below
 *  re-listed what SEVERITY_NUMBERS declares -- one contract, three
 *  declarations, with a guard test existing only to prove they agreed. A test
 *  that exists to prove two declarations agree is the duplication itself.
 *
 *  One schema derived from the as-const arrays; the type follows by z.infer. */
export const EstateSeveritySchema = z.strictObject({
  severity_text: z.enum(SEVERITY_TEXTS),
  // z.literal accepts the array in Zod 4, so the vocabulary is derived rather
  // than re-listed member by member.
  severity_number: z.literal(SEVERITY_NUMBERS),
});
export type EstateSeverity = z.infer<typeof EstateSeveritySchema>;

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
/** SCHEMA-FIRST, and Axis 1: the raw traceparent arrives from process.env,
 *  which the two-axis rule names as a trust boundary alongside HTTP bodies and
 *  query strings. It was validated by a hand-rolled regex plus two all-zero
 *  string checks -- ad-hoc validation at exactly the boundary the rule says
 *  must parse.
 *
 *  Axis 2 as well: trace_id and span_id were declared THREE times -- here, on
 *  SpanContext, and again in EventBaseShape. One schema now; the others derive.
 *
 *  W3C fixes both formats, and declares an all-zero id invalid. */
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const ALL_ZERO = /^0+$/;
const notAllZero = (v: string): boolean => !ALL_ZERO.test(v);

export const TraceContextSchema = z.strictObject({
  trace_id: z.string().regex(TRACE_ID).refine(notAllZero, 'trace_id must not be all zero'),
  span_id: z.string().regex(SPAN_ID).refine(notAllZero, 'span_id must not be all zero'),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

/** This run's span: a TraceContext plus the parent it descends from. Extended
 *  from the same schema rather than re-declaring the two ids. */
export const SpanContextSchema = TraceContextSchema.extend({
  parent_span_id: z.string().regex(SPAN_ID).optional(),
});
export type SpanContext = z.infer<typeof SpanContextSchema>;

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function traceContextFrom(raw: string | undefined): TraceContext | null {
  if (raw === undefined) return null;
  const m = TRACEPARENT.exec(raw.trim());
  if (m === null) return null;
  const [, traceId, spanId] = m;
  // PARSED, not hand-checked. The regex above splits the header; the schema
  // decides whether the parts are a valid context, so the all-zero rule lives
  // in ONE place rather than being re-tested at each call site.
  const parsed = TraceContextSchema.safeParse({ trace_id: traceId, span_id: spanId });
  return parsed.success ? parsed.data : null;
}

/** sha256 of any text, hex. Shared so the snapshot digest and the source
 *  digest are provably the same function -- two hashes computed two ways is a
 *  discrepancy waiting to be misread. */
/** A sha256 content address, as this task produces and accepts them.
 *
 *  SSOT: estate_digest and source_digest were bare z.string() on the event
 *  while digestOf can only ever yield 64 lowercase hex, and --expect-digest
 *  accepted any string at all. Three spellings of one shape, the loosest of
 *  which is the one a caller passes in. */
export const DigestSchema = z.string()
  .regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex digest')
  // BRANDED, exactly as WorktreeState is, and for the identical reason: a
  // z.infer of an unbranded string IS string, so the type bought nothing and
  // every digest parameter still accepted any string at all. Validating only
  // at the argv boundary left the OTHER doors open -- decideEstate is
  // exported, and runEstateVerify is the envelope built for in-process
  // agents, so an agent could pass uppercase hex and loop on REREAD_ESTATE
  // forever. Branding makes that a COMPILE error instead: a caller must parse
  // to obtain one, and parsing is the only constructor.
  //
  // Zero runtime cost -- the brand is a phantom property erased at compile
  // time, so this is enforcement without a check on every call.
  .brand<'Digest'>();
export type Digest = z.infer<typeof DigestSchema>;

export function digestOf(text: string): Digest {
  // parse, not a cast: the brand is only sound if the value went through the
  // schema, and our own output must satisfy the contract we publish.
  return DigestSchema.parse(createHash('sha256').update(text).digest('hex'));
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
export function estateDigest(states: readonly WorktreeState[]): Digest {
  const lines = [...states]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((s) => [
      s.path, s.branch, String(s.dirtyFileCount), String(s.aheadOfRemote),
      String(s.stashCount), String(s.prunable), String(s.locked),
    ].join('\u0000'));
  return digestOf(lines.join("\u0001"));
}

/** Why the estate could not be read. Codes, so a router acts without parsing
 *  prose: git-failed means the subprocess itself failed; no-records means git
 *  exited 0 yet produced no worktree, which cannot happen in a valid repo;
 *  record-rejected means a record did not satisfy the schema. */
export const UNREADABLE_REASONS = Object.freeze([
  'git-failed',
  'no-records',
  'record-rejected',
  // The classifier itself threw. NOT merged into git-failed: that names a
  // subprocess that failed, which is an expected condition with a known
  // remedy, while this names OUR OWN defect and the remedy is a code fix.
  // Collapsing the two would let a bug hide behind an operational excuse.
  'threw',
] as const);
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
  timestamp: string,
  trace: SpanContext | null = null,
  sourceDigest: Digest | null = null,
): EstateUnreadableEvent {
  return {
    'event.name': 'fleet.estate.unreadable',
    schema_version: ESTATE_SCHEMA_VERSION,
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: 'REPAIR_TOOLING',
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
  | { readonly kind: 'no-records'; readonly sourceDigest: Digest }
  | { readonly kind: 'record-rejected'; readonly sourceDigest: Digest }
  | {
      readonly kind: 'states';
      readonly states: readonly WorktreeState[];
      readonly sourceDigest: Digest;
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
  expectDigest: Digest | null = null,
  // Threaded, never read here: decideEstate stays pure and the shell decides
  // what "now" means.
  timestamp = '1970-01-01T00:00:00.000Z',
): EstateDecision {
  switch (g.kind) {
    case 'git-failed':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent('git-failed', timestamp, trace),
        exitCode: exitCodeFor('REPAIR_TOOLING'),
      };
    case 'no-records':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent('no-records', timestamp, trace, g.sourceDigest),
        exitCode: exitCodeFor('REPAIR_TOOLING'),
      };
    case 'record-rejected':
      return {
        kind: 'unreadable',
        event: unreadableEstateEvent('record-rejected', timestamp, trace, g.sourceDigest),
        exitCode: exitCodeFor('REPAIR_TOOLING'),
      };
    case 'states': {
      const actual = estateDigest(g.states);
      // COMPARE-AND-SWAP, before any verdict is reported: a caller that pinned a
      // digest is asking to act only on THAT estate, and reporting a verdict
      // for a different one is the lost-update the check exists to prevent.
      if (expectDigest !== null && expectDigest !== actual) {
        return {
          kind: 'stale',
          event: estateStaleEvent(expectDigest, actual, timestamp, trace),
          exitCode: exitCodeFor('REREAD_ESTATE'),
        };
      }
      const verdict = classifyEstate(g.states);
      return {
        kind: 'verified',
        event: estateTelemetry(verdict, trace, actual, timestamp, g.sourceDigest),
        exitCode: exitCodeFor(actionForVerdict(reasonsAcross(verdict.problems))),
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
  expectedDigest: Digest,
  actualDigest: Digest,
  timestamp: string,
  trace: SpanContext | null = null,
): EstateStaleEvent {
  return {
    'event.name': 'fleet.estate.stale',
    schema_version: ESTATE_SCHEMA_VERSION,
    // WARN, not ERROR: nothing is broken. The caller's view is simply out of
    // date, which is a normal outcome in a concurrent estate and is recovered
    // by re-reading, exactly as a 412 is.
    timestamp,
    producer: ESTATE_PRODUCER,
    agent_action: 'REREAD_ESTATE',
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
export const ESTATE_SCHEMA_VERSION = '1.2.0';

/** WHAT produced the record. A literal, so a consumer can pin it and a typo
 *  cannot masquerade as a different tool. */
export const ESTATE_PRODUCER = 'estate:verify';
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
  // WHEN. An audit record without a timestamp cannot be placed in a sequence,
  // and every 2026 checklist names it in the minimum field set. ISO 8601 UTC
  // with millisecond precision, which is what those checklists specify.
  //
  // The clock is INJECTED, never read here: the core stays pure, the shell
  // supplies the instant, and a test can pin it. That is the same split the
  // gather function already uses.
  timestamp: z.iso.datetime(),
  // WHAT decided. The tool that produced this record, so a reader holding a
  // stream from several producers can attribute one line to one tool.
  //
  // NOT a human or machine ACTOR, deliberately. This runs on a laptop with no
  // verifiable identity to assert, and 2026 audit guidance is blunt that a
  // wrong or ambiguous identity is a failed control -- "a shared service
  // account ran the action, so who is ambiguous". An unverifiable identity
  // claim in an audit record is worse than its absence: it reads as evidence
  // and carries none, the identical argument that keeps the in-toto Statement
  // unsigned. A runner WITH an identity -- CI with OIDC -- attributes the run
  // through the trace it supplies.
  producer: z.literal(ESTATE_PRODUCER),
  // DERIVED from TraceContextSchema: the two ids were declared here as loose
  // strings while the context schema constrained them, so an event could carry
  // an id the context would have rejected.
  trace_id: TraceContextSchema.shape.trace_id.optional(),
  span_id: TraceContextSchema.shape.span_id.optional(),
  // WHAT THE CALLER MAY DO, beside what was observed. An orchestrator reading
  // this stream off a collector never sees an exit code, so without this field
  // it has to re-derive the policy from attributes -- a second implementation
  // of the rule, waiting to disagree with the first. assert-parses.ts has
  // carried agent_action for the same reason since it was written.
  // ADVISORY, NEVER AUTHORIZATION. This is what the tool RECOMMENDS given what
  // it observed; it is not permission to act. 2026 agent-governance guidance is
  // explicit that no field a tool emits is self-authorizing, and that a
  // capability gate is not an authorization decision -- a consumer treating
  // PROCEED as consent is the confused-deputy failure. The policy decision
  // point sits OUTSIDE this tool; what the tool owes it is a recommendation
  // bound to the evidence it was derived from, which estate_digest supplies.
  agent_action: EstateActionSchema,
  // The span this run was a CHILD of. Present whenever a parent supplied a
  // traceparent, so a collector can nest this task under the run that invoked it.
  parent_span_id: SpanContextSchema.shape.parent_span_id,
} as const;

export const EstateTelemetrySchema = z.strictObject({
  'event.name': z.literal('fleet.estate.verified'),
  ...EventBaseShape,
  // DERIVED from EstateSeveritySchema, not re-listed. The numbers were spelled
  // out here AND in SEVERITY_NUMBERS, so a guard test existed only to prove the
  // two agreed -- which is the duplication, not a defence against it.
  severity_text: EstateSeveritySchema.shape.severity_text,
  severity_number: EstateSeveritySchema.shape.severity_number,
  // REQUIRED on a verdict, because the recommendation above is derived from
  // THIS snapshot and nothing else. A recommendation whose evidence cannot be
  // named is one a downstream PDP cannot re-verify -- and re-verification is
  // exactly what --expect-digest exists to make possible. Optional here was a
  // type admitting an unbindable action.
  estate_digest: DigestSchema,
  source_digest: DigestSchema.optional(),
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
  source_digest: DigestSchema.optional(),
  attributes: z.strictObject({ reason: z.enum(UNREADABLE_REASONS) }),
});

export const EstateStaleEventSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.stale'),
  ...EventBaseShape,
  severity_text: z.literal('WARN'),
  severity_number: z.literal(13),
  attributes: z.strictObject({
    expected_digest: DigestSchema,
    estate_digest: DigestSchema,
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

// scripts/estate-gather.ts
// THE OBSERVATION BOUNDARY: raw git output becomes a versioned event, or it
// becomes nothing.
//
// TWO JOBS, ONE MODULE, AND THAT COLOCATION IS THE POINT. This file owns the
// porcelain parser AND the observation constructor, because an authorized
// constructor must derive the digest and the parsed representation ATOMICALLY
// from the same source. An earlier design took the parser as an injected
// parameter to avoid moving it; that reopens the hole it closes -- a caller
// could pass a parser returning records unrelated to the bytes being hashed,
// producing an observation whose digest and states describe different worlds.
// 2026 practice is unambiguous: the parsed value "can only exist if it is
// valid", and there must be no path that produces one without going through the
// parser. An injection point IS such a path.
//
// parseWorktreeRecords moved here from estate-verify-cli.ts, which re-exports it
// so its existing tests resolve unchanged -- the same re-export the driver
// already uses for estateLineFor. It was always pure; it was merely stranded in
// the side-effecting driver, above the module that needed it.
//
// THE DEFECT THIS FILE ORIGINALLY CLOSED, still closed. gatherOne called a
// helper that swallowed the exit code and returned '' on failure, and
// countLines('') is 0 -- so a failed `git status --porcelain` read as a CLEAN
// working tree. The schema cannot catch that: 0 is a valid count, well-formed
// and simply false. EMPTY IS NOT FAILED, so every reading is a discriminated
// outcome rather than a string.
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  DigestSchema,
  EventEnvelopeShape,
  ESTATE_PRODUCER,
  ESTATE_SCHEMA_VERSION,
  digestOf,
  eventIdFor,
  type CorrelationId,
  type Digest,
  type EventId,
  type SpanId,
  type Timestamp,
  type TraceId,
} from './estate-events.js';
import { WorktreeStateSchema, toWorktreeState, type WorktreeState } from './estate-verify.js';

/** One record from `git worktree list --porcelain`, BEFORE the per-worktree
 *  readings are taken. The shape was hand-written four times -- the parser's
 *  return type, its accumulator, its cursor, and gatherOneFrom's parameter --
 *  which is the duplication the schema-first rule names, across a module
 *  boundary at that. */
export const WorktreeRecordSchema = z.strictObject({
  path: z.string(),
  branch: z.string(),
  locked: z.boolean(),
  prunable: z.boolean(),
});
export type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;

export const GitOutcomeSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), out: z.string() }),
  z.strictObject({ ok: z.literal(false) }),
]);
export type GitOutcome = z.infer<typeof GitOutcomeSchema>;

/** The four readings one worktree needs. */
export const WorktreeReadingsSchema = z.strictObject({
  /** `git rev-parse @{u}`. Failure is EXPECTED and normal: a branch with no
   *  upstream cannot be ahead of one, which the driver observed on its first
   *  live run. This is the ONE call whose failure is not a defect. */
  upstream: GitOutcomeSchema,
  /** `git rev-list --count upstream..HEAD`, read only when an upstream exists. */
  ahead: GitOutcomeSchema,
  /** `git status --porcelain`. Empty means clean; FAILED means unknown. */
  status: GitOutcomeSchema,
  /** `git stash list`. Empty means none; FAILED means unknown. */
  stash: GitOutcomeSchema,
});
export type WorktreeReadings = z.infer<typeof WorktreeReadingsSchema>;

/** What one worktree yielded. Three outcomes, not two: a git command that could
 *  not run is neither a state nor a schema rejection, and reporting it as
 *  either would misname the remedy. */
export type GatheredOne =
  | { readonly kind: 'state'; readonly state: WorktreeState }
  | { readonly kind: 'git-failed' }
  | { readonly kind: 'rejected' };

const NL = String.fromCharCode(10);

/** Lines in command output. Only ever called on output that RAN. */
function countLines(s: string): number {
  return s.length === 0 ? 0 : s.split(NL).length;
}

/** One worktree record from `git worktree list --porcelain`. Blank-line
 *  separated; a record may carry bare `locked` / `prunable` markers, and a
 *  detached one carries no `branch` line at all. */
export function parseWorktreeRecords(
  porcelain: string,
): readonly WorktreeRecord[] {
  const out: WorktreeRecord[] = [];
  let cur: WorktreeRecord | null = null;
  for (const line of porcelain.split(NL)) {
    if (line.startsWith('worktree ')) {
      if (cur !== null) out.push(cur);
      // Canonicalised HERE, before the schema sees it: porcelain is normally
      // absolute, but resolve also flattens any .. segment or trailing slash so
      // the same worktree can never appear under two spellings.
      cur = {
        path: resolve(line.slice('worktree '.length)),
        branch: '(detached)',
        locked: false,
        prunable: false,
      };
    } else if (cur === null) {
      continue;
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      cur.prunable = true;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

/** One worktree's readings, resolved into a state or a named failure.
 *
 *  Every required reading must have RUN. Previously a failure here produced a
 *  zero and the zero was reported as cleanliness; now it produces git-failed,
 *  which the decider turns into exit 3 and REPAIR_TOOLING. */
export function gatherOneFrom(
  rec: WorktreeRecord,
  readings: WorktreeReadings,
): GatheredOne {
  // status and stash are REQUIRED. Empty output from them is meaningful; a
  // failure is not, and must never be read as a zero.
  if (!readings.status.ok || !readings.stash.ok) return { kind: 'git-failed' };

  // NO UPSTREAM is a normal state, not a failure: nothing to be ahead of.
  const hasUpstream = readings.upstream.ok && readings.upstream.out.length > 0;

  // But if there IS an upstream, counting against it must succeed. A failed
  // count previously became 0 -- "no unpushed commits" -- which is the same
  // confident zero wearing a different hat.
  if (hasUpstream && !readings.ahead.ok) return { kind: 'git-failed' };

  const ahead = hasUpstream && readings.ahead.ok
    ? Number(readings.ahead.out.length > 0 ? readings.ahead.out : '0')
    : 0;
  // git prints a decimal count; anything else means the format moved under us.
  if (!Number.isFinite(ahead) || !Number.isInteger(ahead) || ahead < 0) {
    return { kind: 'git-failed' };
  }

  const state = toWorktreeState({
    path: rec.path,
    branch: rec.branch,
    dirtyFileCount: countLines(readings.status.out),
    aheadOfRemote: ahead,
    stashCount: countLines(readings.stash.out),
    prunable: rec.prunable,
    locked: rec.locked,
  });
  return state === null ? { kind: 'rejected' } : { kind: 'state', state };
}

/** WHY THE OBSERVATION COULD NOT BE MADE. Codes, so a router acts without
 *  parsing prose. Distinct from the estate being unclean: these say the estate
 *  was never read at all. */
export const UNOBSERVABLE_REASONS = Object.freeze([
  'git-failed',
  'no-records',
  'record-rejected',
] as const);
export type UnobservableReason = (typeof UNOBSERVABLE_REASONS)[number];

/** THE OBSERVATION EVENT -- the fact the decider consumes.
 *
 *  It replaces {kind:'states', states, sourceDigest}, an internal shape with no
 *  event name, no schema version and no parse step, which the 2026 agentic-loop
 *  rule names as forbidden by example. The asymmetry was real: outputs were
 *  versioned events while the input was a bare object, so runEstateVerify --
 *  whose gather function is INJECTED, and therefore agent-supplied -- accepted
 *  states from one estate beside a digest from anywhere.
 *
 *  causation_id is null on an observation. That is meaningful rather than
 *  incidental: an observation is the ROOT of a causal chain, caused by the
 *  world and not by another event. */
export const EstateObservedSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.observed'),
  ...EventEnvelopeShape,
  source_digest: DigestSchema,
  states: z.array(WorktreeStateSchema).readonly(),
});
export type EstateObserved = z.infer<typeof EstateObservedSchema>;

/** AN OBSERVATION THAT OBSERVED NOTHING is a different fact from an observation
 *  of an empty estate, and giving it its own event name is what keeps the two
 *  from sharing a shape. That confusion is the confident zero this whole arc
 *  exists to refuse: `git worktree list` in any valid repository lists at least
 *  the MAIN worktree, so zero records is never a legitimate answer.
 *
 *  source_digest is OPTIONAL here and required above, which is not sloppiness:
 *  a git command that could not run produced no porcelain, so there are no
 *  bytes to address. Claiming a digest for absent evidence would be fabricating
 *  provenance. */
export const EstateUnobservableSchema = z.strictObject({
  'event.name': z.literal('fleet.estate.unobservable'),
  ...EventEnvelopeShape,
  reason: z.enum(UNOBSERVABLE_REASONS),
  source_digest: DigestSchema.optional(),
});
export type EstateUnobservable = z.infer<typeof EstateUnobservableSchema>;

export const EstateObservationSchema = z.discriminatedUnion('event.name', [
  EstateObservedSchema,
  EstateUnobservableSchema,
]);
export type EstateObservation = z.infer<typeof EstateObservationSchema>;

/** What every observation needs beside the git output: the correlation it
 *  belongs to, the clock, and any inherited trace context. Injected, so the
 *  constructor stays pure and a test pins every field. */
export interface ObservationContext {
  readonly correlationId: CorrelationId;
  readonly occurredAt: Timestamp;
  readonly traceId?: TraceId | undefined;
  readonly spanId?: SpanId | undefined;
  readonly parentSpanId?: SpanId | undefined;
}

function envelope(
  ctx: ObservationContext,
  eventId: EventId,
): Record<string, unknown> {
  return {
    schema_version: ESTATE_SCHEMA_VERSION,
    event_id: eventId,
    correlation_id: ctx.correlationId,
    // NULL: an observation is caused by the world, not by a prior event.
    causation_id: null,
    occurred_at: ctx.occurredAt,
    producer: ESTATE_PRODUCER,
    ...(ctx.traceId === undefined ? {} : { trace_id: ctx.traceId }),
    ...(ctx.spanId === undefined ? {} : { span_id: ctx.spanId }),
    ...(ctx.parentSpanId === undefined ? {} : { parent_span_id: ctx.parentSpanId }),
  };
}

/** THE AUTHORIZED CONSTRUCTOR. The only way to mint an observation.
 *
 *  It takes the RAW PORCELAIN and nothing else about the estate, so the digest
 *  and the records are derived from the same bytes inside one function body. A
 *  caller cannot hand over a mismatched pair because it hands over a single
 *  string -- which is what makes source_digest evidence rather than a claim.
 *
 *  The per-worktree readings ARE injected, because taking them would mean
 *  spawning git from a pure module. That is a different boundary: readFor is
 *  called once per PARSED record, so it cannot introduce worktrees the
 *  porcelain never mentioned. The set of paths is fixed by the bytes. */
export function observeEstate(
  porcelain: string,
  readFor: (rec: WorktreeRecord) => WorktreeReadings,
  ctx: ObservationContext,
): EstateObservation {
  const sourceDigest: Digest = digestOf(porcelain);
  const records = parseWorktreeRecords(porcelain);

  if (records.length === 0) {
    return unobservable('no-records', ctx, sourceDigest);
  }

  const gathered = records.map((rec) => gatherOneFrom(rec, readFor(rec)));
  // A GIT COMMAND THAT COULD NOT RUN is named as such, never folded into the
  // schema-rejection reason: the remedies differ, and reporting a broken git as
  // a malformed record sends the operator to the wrong place.
  if (gathered.some((g) => g.kind === 'git-failed')) {
    return unobservable('git-failed', ctx, sourceDigest);
  }
  if (gathered.some((g) => g.kind === 'rejected')) {
    return unobservable('record-rejected', ctx, sourceDigest);
  }

  const states = gathered.flatMap((g) => (g.kind === 'state' ? [g.state] : []));
  // The id is DERIVED from the content, never random: replaying the same
  // porcelain must yield the same event, which a randomUUID would break.
  const eventId = eventIdFor('fleet.estate.observed', sourceDigest);
  return EstateObservedSchema.parse({
    'event.name': 'fleet.estate.observed',
    ...envelope(ctx, eventId),
    source_digest: sourceDigest,
    states,
  });
}

/** The observation that could not be made. Exported because the driver reaches
 *  it directly when `git worktree list` itself fails -- there is no porcelain
 *  to hand observeEstate, and inventing an empty string would manufacture a
 *  digest for evidence that does not exist. */
export function unobservable(
  reason: UnobservableReason,
  ctx: ObservationContext,
  sourceDigest?: Digest,
): EstateUnobservable {
  const eventId = eventIdFor('fleet.estate.unobservable', reason + (sourceDigest ?? ''));
  return EstateUnobservableSchema.parse({
    'event.name': 'fleet.estate.unobservable',
    ...envelope(ctx, eventId),
    reason,
    ...(sourceDigest === undefined ? {} : { source_digest: sourceDigest }),
  });
}

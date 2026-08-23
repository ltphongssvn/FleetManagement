// scripts/estate-decide.test.ts
// THE DECIDER: event in, decision out.
//
// EXTRACTED from estate-verify.test.ts, which had grown to 1405 lines covering
// the classifier, the schemas, the rendering AND these suites. They are a
// different subject: everything here exercises decideEstate, whose INPUT is now
// a versioned observation event rather than an internal shape.
//
// WHY THE SIGNATURE CHANGED. decideEstate consumed {kind:'states', states,
// sourceDigest} -- no event name, no schema version, and nothing parsed it. The
// 2026 agentic-loop rule names that shape as forbidden by example, and the gap
// had a concrete exploit rather than a theoretical one: runEstateVerify takes
// its gather function by INJECTION, so an agent could supply states from one
// estate beside a sourceDigest from anywhere. Nothing bound the pair, and
// source_digest exists precisely to answer "did the estate move, or did the
// parser change" -- evidence that can be fabricated answers nothing.
//
// Every case below is built through observedFixture or unobservableFixture,
// which parse against the same schemas production does. So a test cannot express
// an input observeEstate could never produce -- the fixture drift that let
// admin-drivers-client fixtures omit six required fields and pass anyway.
import { describe, it, expect } from 'vitest';
import {
  DigestSchema,
  EstateEventSchema,
  TimestampSchema,
  TraceContextSchema,
  createWorktreeState,
  decideEstate,
  digestOf,
  estateDigest,
  estateTelemetry,
  classifyEstate,
  observedFixture,
  unobservableFixture,
  unreadableEstateEvent,
  estateStaleEvent,
  UNOBSERVABLE_REASONS,
} from './estate-verify.ts';

const CLEAN = createWorktreeState({ path: '/c/t1-wt1-x', branch: 'feat/x' });
const AT = TimestampSchema.parse('2026-01-01T00:00:00.000Z');

// ---- the driver's decisions, now reachable ----
// These fail-closed paths were decided inline in mainEstateVerify, which lives
// under a v8-ignore because it spawns git -- so "git threw, so emit git-failed
// and exit 3" was verified by reading the code and nothing else. Moving the
// instantiation up a level and testing the INTERACTION is the 2026 answer for
// subprocess-bearing CLIs, and the split decideClose and decideMergeReady
// already use here.
describe('decideEstate', () => {
  const DIGEST = digestOf('worktree /c/a');

  it('git-failed emits the unreadable event and exits 3', () => {
    const d = decideEstate(unobservableFixture('git-failed'));
    expect(d.exitCode).toBe(3);
    expect(d.event['event.name']).toBe('fleet.estate.unreadable');
    expect(d.kind).toBe('unreadable');
  });

  // The confident zero: git exited 0 and produced nothing parseable.
  it('no-records exits 3, never 0', () => {
    const d = decideEstate(unobservableFixture('no-records', DIGEST));
    expect(d.exitCode).toBe(3);
    expect(d.kind).toBe('unreadable');
  });

  it('record-rejected exits 3 rather than reporting over the survivors', () => {
    const d = decideEstate(unobservableFixture('record-rejected', DIGEST));
    expect(d.exitCode).toBe(3);
    expect(d.kind).toBe('unreadable');
  });

  // Each unobservable path names ITSELF, which the single shared payload could
  // not. DERIVED from the vocabulary, so a new reason is covered without anyone
  // remembering to extend this list.
  it('each unreadable path carries its own reason', () => {
    for (const reason of UNOBSERVABLE_REASONS) {
      const observation =
        reason === 'git-failed' ? unobservableFixture(reason) : unobservableFixture(reason, DIGEST);
      expect(decideEstate(observation).event.attributes).toEqual({ reason });
    }
  });

  it('a clean estate exits 0 and carries a verdict', () => {
    const d = decideEstate(observedFixture([CLEAN], DIGEST));
    expect(d.exitCode).toBe(0);
    expect(d.event['event.name']).toBe('fleet.estate.verified');
    if (d.kind !== 'verified') throw new Error('expected verified');
    expect(d.verdict.clean).toBe(true);
  });

  it('an unclean estate exits 1, distinct from unreadable', () => {
    const d = decideEstate(
      observedFixture([createWorktreeState({ path: '/c/a', dirtyFileCount: 1 })], DIGEST),
    );
    expect(d.exitCode).toBe(1);
    if (d.kind !== 'verified') throw new Error('expected verified');
    expect(d.verdict.clean).toBe(false);
  });

  // git-failed has no porcelain to address, so it cannot carry a source digest.
  // The OBSERVATION schema makes that structural rather than conventional:
  // source_digest is optional there and required on the observed variant.
  it('carries the source digest only when the porcelain was readable', () => {
    const gf = decideEstate(unobservableFixture('git-failed')).event;
    if (gf['event.name'] !== 'fleet.estate.unreadable') throw new Error('expected unreadable');
    expect(gf.source_digest).toBeUndefined();
    const nr = decideEstate(unobservableFixture('no-records', DIGEST)).event;
    if (nr['event.name'] !== 'fleet.estate.unreadable') throw new Error('expected unreadable');
    expect(nr.source_digest).toBe(DIGEST);
  });

  it('passes inherited trace context through to the event', () => {
    const trace = TraceContextSchema.parse({ trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) });
    expect(decideEstate(unobservableFixture('git-failed'), trace).event.trace_id).toBe(
      'a'.repeat(32),
    );
    expect(decideEstate(observedFixture([CLEAN], DIGEST), trace).event.trace_id).toBe(
      'a'.repeat(32),
    );
  });

  // A verdict is present ONLY when one was computed, so a caller cannot render
  // prose about an estate that was never read.
  it('never returns a verdict on an unreadable path', () => {
    for (const reason of UNOBSERVABLE_REASONS) {
      const observation =
        reason === 'git-failed' ? unobservableFixture(reason) : unobservableFixture(reason, DIGEST);
      expect(decideEstate(observation).kind).toBe('unreadable');
    }
  });
});

// ---- compare-and-swap: bind an action to the estate it was planned against ----
// estate_digest let a caller RECORD what it observed; nothing let it BIND an
// action to that observation, so the caller re-ran and compared digests itself
// -- and a check performed separately from the act is exactly the split
// compare-and-swap closes. Two laptops and many worktrees mutate this estate
// concurrently, so a plan made at digest X can execute against a world at Y.
//
// This is If-Match / 412, value-based rather than a version counter: the digest
// IS the content, so it cannot drift from what it describes.
describe('decideEstate: --expect-digest precondition', () => {
  const STATES = [createWorktreeState({ path: '/c/a', branch: 'x' })];
  const SRC = digestOf('worktree /c/a');
  const CURRENT = estateDigest(STATES);

  it('proceeds when the estate is still the one that was planned against', () => {
    const d = decideEstate(observedFixture(STATES, SRC), null, CURRENT);
    expect(d.exitCode).toBe(0);
    expect(d.event['event.name']).toBe('fleet.estate.verified');
  });

  it('REFUSES with exit 4 when the estate moved underneath', () => {
    const d = decideEstate(observedFixture(STATES, SRC), null, digestOf('stale'));
    expect(d.exitCode).toBe(4);
    expect(d.event['event.name']).toBe('fleet.estate.stale');
    expect(d.kind).toBe('stale');
  });

  // Both digests, so the caller can diff its plan against reality rather than
  // re-deriving what it thought it knew.
  it('names both the expected and the actual digest', () => {
    const stale = digestOf('stale');
    const d = decideEstate(observedFixture(STATES, SRC), null, stale);
    if (d.event['event.name'] !== 'fleet.estate.stale') throw new Error('expected stale');
    expect(d.event.attributes.expected_digest).toBe(stale);
    expect(d.event.attributes.estate_digest).toBe(CURRENT);
  });

  // Omitted means "I did not plan against anything", which must behave exactly
  // as before -- an opt-in precondition, like If-Match.
  it('is opt-in: omitting it changes nothing', () => {
    expect(decideEstate(observedFixture(STATES, SRC)).exitCode).toBe(0);
    expect(decideEstate(observedFixture(STATES, SRC), null, null).exitCode).toBe(0);
  });

  // The check runs BEFORE the verdict, so a dirty estate that also moved
  // reports the staleness -- re-reading is the fix, not cleaning worktrees.
  it('staleness outranks uncleanliness, because re-reading comes first', () => {
    const dirty = [createWorktreeState({ path: '/c/a', dirtyFileCount: 3 })];
    const d = decideEstate(observedFixture(dirty, SRC), null, digestOf('stale'));
    expect(d.exitCode).toBe(4);
  });

  // An unreadable estate cannot be compared at all: there is no digest to
  // match, so the precondition must not mask the more serious failure.
  it('never masks an unreadable estate', () => {
    const d = decideEstate(unobservableFixture('git-failed'), null, digestOf('anything'));
    expect(d.exitCode).toBe(3);
    expect(d.event['event.name']).toBe('fleet.estate.unreadable');
  });

  it('exit 4 is distinct from every other outcome', () => {
    const codes = new Set([
      decideEstate(observedFixture(STATES, SRC)).exitCode,
      decideEstate(observedFixture([createWorktreeState({ dirtyFileCount: 1 })], SRC)).exitCode,
      decideEstate(unobservableFixture('git-failed')).exitCode,
      decideEstate(observedFixture(STATES, SRC), null, digestOf('x')).exitCode,
    ]);
    expect(codes).toEqual(new Set([0, 1, 3, 4]));
  });
});

// Every event the DECIDER can produce parses against the published contract --
// not just the ones constructed by hand elsewhere. This is the executable link
// between what we DECLARE and what we EMIT.
describe('every decision the decider can reach is schema-valid', () => {
  const STATES = [createWorktreeState({ path: '/c/a', branch: 'x' })];
  const SRC = digestOf('raw');

  it('accepts every decision the decider can reach', () => {
    const decisions = [
      decideEstate(unobservableFixture('git-failed')),
      decideEstate(unobservableFixture('no-records', SRC)),
      decideEstate(unobservableFixture('record-rejected', SRC)),
      decideEstate(observedFixture(STATES, SRC)),
      decideEstate(observedFixture(STATES, SRC), null, digestOf('x')),
    ];
    for (const d of decisions) {
      expect(EstateEventSchema.safeParse(d.event).success).toBe(true);
    }
  });

  // DETERMINISM. The observation's event id is derived from its content, so
  // replaying the same observation must yield a byte-identical decision -- the
  // property a randomUUID would have broken, and the one the agentic-loop rule
  // demands when it asks for "the same agent decisions when replaying any
  // historical event sequence".
  it('reaches a byte-identical event when the same observation is replayed', () => {
    const once = decideEstate(observedFixture(STATES, SRC), null, null, AT);
    const twice = decideEstate(observedFixture(STATES, SRC), null, null, AT);
    expect(JSON.stringify(once.event)).toBe(JSON.stringify(twice.event));
  });
});

// ---- the recommendation is advisory, never authorization ----
// agent_action tells a consumer what this tool RECOMMENDS given what it saw. It
// is not permission to act, and a consumer treating PROCEED as consent is the
// confused-deputy failure 2026 agent-governance work names directly: no field a
// tool emits is self-authorizing, and a capability gate is not an authorization
// decision. The policy decision point sits OUTSIDE this tool.
//
// What the tool owes that PDP is a recommendation BOUND TO ITS EVIDENCE. A
// decision is not execution authority until it can be tied to the exact state
// it was computed from -- so estate_digest is required on a verdict, and the
// pair (agent_action, estate_digest) is re-verifiable by handing the digest
// back through --expect-digest.
describe('the recommendation is bound to its evidence', () => {
  const STATES = [createWorktreeState({ path: '/c/a', dirtyFileCount: 1 })];
  const SNAPSHOT = estateDigest(STATES);
  const SRC = digestOf('raw');

  it('a verdict always names the snapshot it was computed from', () => {
    const e = estateTelemetry(classifyEstate(STATES), null, SNAPSHOT, AT);
    expect(e.estate_digest).toBe(SNAPSHOT);
  });

  // The binding, stated as the property that makes it useful: the digest on the
  // event is exactly what a caller hands back to re-verify.
  it('the emitted digest is the one --expect-digest accepts', () => {
    const decided = decideEstate(observedFixture(STATES, SRC));
    if (decided.kind !== 'verified') throw new Error('expected verified');
    const replayed = decideEstate(observedFixture(STATES, SRC), null, decided.event.estate_digest);
    expect(replayed.kind).toBe('verified');
  });

  // And the same binding REFUSES once the estate has moved, which is what makes
  // the recommendation checkable rather than merely advisory-in-name.
  it('a recommendation cannot be replayed against a moved estate', () => {
    const decided = decideEstate(observedFixture(STATES, SRC));
    if (decided.kind !== 'verified') throw new Error('expected verified');
    const moved = [createWorktreeState({ path: '/c/a', dirtyFileCount: 99 })];
    const replayed = decideEstate(observedFixture(moved, SRC), null, decided.event.estate_digest);
    expect(replayed.kind).toBe('stale');
    expect(replayed.event.agent_action).toBe('REREAD_ESTATE');
  });

  // The SOURCE digest travels from the observation onto the verdict, unaltered.
  // That is what lets a consumer tell an estate that moved from a parser that
  // changed -- and it is only trustworthy because observeEstate derived both
  // from the same porcelain bytes.
  it('carries the observation source digest onto the verdict', () => {
    const d = decideEstate(observedFixture(STATES, SRC));
    if (d.event['event.name'] !== 'fleet.estate.verified') throw new Error('expected verified');
    expect(d.event.source_digest).toBe(SRC);
  });

  // Every event a subscriber can act on carries an action; the verdict path
  // additionally carries the evidence. An unreadable estate has no snapshot to
  // address, which is why it carries no digest and recommends REPAIR_TOOLING.
  it('an unreadable estate recommends repair and names no snapshot', () => {
    const e = unreadableEstateEvent('git-failed', AT);
    expect(e.agent_action).toBe('REPAIR_TOOLING');
    expect('estate_digest' in e).toBe(false);
  });

  it('a stale estate names BOTH digests, so the caller can diff its plan', () => {
    const e = estateStaleEvent(digestOf('planned'), SNAPSHOT, AT);
    expect(e.agent_action).toBe('REREAD_ESTATE');
    expect(e.attributes.expected_digest).toBe(digestOf('planned'));
    expect(e.attributes.estate_digest).toBe(SNAPSHOT);
  });
});

// ---- the only way to get a Digest is to parse one ----
// Validating --expect-digest closed the ARGV door and left the others open:
// decideEstate is exported, and runEstateVerify is the envelope built for
// in-process agents. An agent could hand either an uppercase digest and get
// STALE with REREAD_ESTATE -- advice that can never succeed, because re-reading
// never makes a malformed digest match.
//
// The root fix is nominal typing, which this arc already uses for WorktreeState:
// a z.infer of an UNBRANDED string is just string, so the type bought nothing.
// Branded, the compiler refuses an unparsed string outright, at zero runtime
// cost since the brand is erased.
//
// The directives below ARE the assertion: each fails the BUILD if its line ever
// starts compiling, which is precisely the regression worth pinning.
describe('a digest cannot be conjured from a string', () => {
  const STATES = [createWorktreeState({ path: '/c/a', branch: 'x' })];
  const OBSERVED = observedFixture(STATES, digestOf('raw'));

  it('REFUSES a raw string as --expect-digest, at compile time', () => {
    // @ts-expect-error a plain string is not a parsed Digest
    decideEstate(OBSERVED, null, 'a'.repeat(64));
    expect(true).toBe(true);
  });

  it('REFUSES an uppercase digest, the case that looked valid', () => {
    // @ts-expect-error uppercase hex never matches our lowercase output
    decideEstate(OBSERVED, null, 'A1B2'.repeat(16));
    expect(true).toBe(true);
  });

  it('ACCEPTS one that came through the schema', () => {
    const d = decideEstate(OBSERVED, null, DigestSchema.parse('a'.repeat(64)));
    expect(d.kind).toBe('stale');
  });

  it('ACCEPTS one produced by our own hashing', () => {
    const d = decideEstate(OBSERVED, null, estateDigest(STATES));
    expect(d.kind).toBe('verified');
  });

  // The runtime half: parsing is what refuses, and it refuses the same set the
  // CLI boundary does -- one rule, not two.
  it('REJECTS at runtime exactly what it refuses at compile time', () => {
    for (const bad of ['garbage', '', 'A1B2'.repeat(16), 'a'.repeat(63)]) {
      expect(DigestSchema.safeParse(bad).success).toBe(false);
    }
    expect(DigestSchema.safeParse('a'.repeat(64)).success).toBe(true);
  });

  // Our own output must satisfy the contract we publish, or the brand is a lie.
  it('every digest this task produces parses as one', () => {
    expect(DigestSchema.safeParse(digestOf('anything')).success).toBe(true);
    expect(DigestSchema.safeParse(estateDigest(STATES)).success).toBe(true);
    expect(DigestSchema.safeParse(estateDigest([])).success).toBe(true);
  });
});

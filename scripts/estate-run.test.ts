// scripts/estate-run.test.ts
// The envelope: one call, both surfaces, no transport.
//
// WHAT THIS MAKES POSSIBLE. gatherEstate and the whole gather-decide-render
// sequence used to live module-private inside estate-verify-cli.ts, under a
// v8-ignore, fused into a main() that read process.argv and wrote two streams.
// So the path from "a repo on disk" to a decision could only be exercised by
// SPAWNING THE PROCESS, and an in-process runtime had to either shell out and
// parse stdout or re-implement gathering -- the duplication 2026 guidance names
// directly: the capability belongs in a library, and logic left in one surface
// is duplicated when the second arrives, after which the two drift.
//
// Gathering is INJECTED, so every test below drives the real decision path
// without spawning git, without a repo, and without touching argv.
import { describe, it, expect } from 'vitest';
import { runEstateVerify, estateLineFor } from './estate-run.js';
import {
  EstateEventSchema,
  createWorktreeState,
  decideEstate,
  digestOf,
  estateDigest,
  type EstateGathered,
} from './estate-verify.js';

const CLEAN = createWorktreeState({ path: '/c/a', branch: 'x' });
const DIRTY = createWorktreeState({ path: '/c/b', dirtyFileCount: 2 });
const BROKEN = createWorktreeState({ path: '/c/c', prunable: true });
const SRC = digestOf('worktree /c/a');

function gathering(...states: readonly ReturnType<typeof createWorktreeState>[]) {
  return (): EstateGathered => ({ kind: 'states', states, sourceDigest: SRC });
}

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

// A FIXED instant, injected on both sides of any comparison. The events carry a
// timestamp now, so a test reading the real clock would compare two different
// moments and flap -- which is precisely why the clock is a parameter.
const AT = '2026-01-01T00:00:00.000Z';

describe('runEstateVerify: the whole path, without spawning git', () => {
  it('reaches a verdict from injected facts alone', () => {
    const r = runEstateVerify({ gather: gathering(CLEAN) });
    expect(r.decision.kind).toBe('verified');
    expect(r.event['event.name']).toBe('fleet.estate.verified');
  });

  it('reports a clean estate as PROCEED, exit 0, and permission to continue', () => {
    const r = runEstateVerify({ gather: gathering(CLEAN) });
    expect(r.action).toBe('PROCEED');
    expect(r.exitCode).toBe(0);
    expect(r.mayProceed).toBe(true);
  });

  it('halts on work in progress', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY), now: () => AT });
    expect(r.action).toBe('HALT_WORK_IN_PROGRESS');
    expect(r.exitCode).toBe(1);
    expect(r.mayProceed).toBe(false);
  });

  it('halts structurally, which outranks work in progress', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY, BROKEN) });
    expect(r.action).toBe('HALT_STRUCTURAL');
    expect(r.mayProceed).toBe(false);
  });

  // The three fail-closed paths, now reachable without a broken repo.
  it('carries every unreadable outcome through to exit 3', () => {
    for (const kind of ['git-failed', 'no-records', 'record-rejected'] as const) {
      const gather = (): EstateGathered =>
        kind === 'git-failed' ? { kind } : { kind, sourceDigest: SRC };
      const r = runEstateVerify({ gather });
      expect(r.exitCode).toBe(3);
      expect(r.action).toBe('REPAIR_TOOLING');
      expect(r.mayProceed).toBe(false);
    }
  });

  it('refuses with exit 4 when the estate moved from the plan', () => {
    const r = runEstateVerify({
      gather: gathering(CLEAN),
      expectDigest: digestOf('planned elsewhere'),
    });
    expect(r.exitCode).toBe(4);
    expect(r.action).toBe('REREAD_ESTATE');
  });

  it('proceeds when the plan still matches the estate', () => {
    const r = runEstateVerify({
      gather: gathering(CLEAN),
      expectDigest: estateDigest([CLEAN]),
    });
    expect(r.exitCode).toBe(0);
  });
});

// The point of the envelope: NEITHER surface re-derives anything. A second
// derivation is how a CLI and a runtime come to disagree about the same run.
describe('both surfaces read one computation', () => {
  it('gives the exit code the decision reached, never a recomputed one', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY), now: () => AT });
    expect(r.exitCode).toBe(r.decision.exitCode);
  });

  it('gives the action the event carries, never a recomputed one', () => {
    const r = runEstateVerify({ gather: gathering(BROKEN) });
    expect(r.action).toBe(r.decision.event.agent_action);
  });

  it('gives the same line the CLI prints', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY), now: () => AT });
    expect(r.line).toBe(estateLineFor(r.decision));
  });

  it('gives the event the CLI writes to stdout, schema-valid', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY, BROKEN) });
    expect(EstateEventSchema.safeParse(r.event).success).toBe(true);
  });

  // mayProceed is a value here rather than a rule each consumer re-implements.
  it('agrees with the exit code on whether work may continue', () => {
    for (const states of [[CLEAN], [DIRTY], [BROKEN], [DIRTY, BROKEN]]) {
      const r = runEstateVerify({ gather: gathering(...states) });
      expect(r.mayProceed).toBe(r.exitCode === 0);
    }
  });

  it('renders the same decision the pure decider would', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY), now: () => AT });
    const direct = decideEstate(
      { kind: 'states', states: [DIRTY], sourceDigest: SRC }, null, null, AT,
    );
    expect(r.event).toEqual(direct.event);
  });
});

// Trace context arrives as a VALUE, not from the environment, so a runtime
// holding a trace in memory does not have to write to process.env to be heard.
describe('trace context is passed, not read from the environment', () => {
  it('joins the caller trace when a traceparent is supplied', () => {
    const r = runEstateVerify({ gather: gathering(CLEAN), traceparent: TRACEPARENT });
    expect(r.event.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(r.event.parent_span_id).toBe('00f067aa0ba902b7');
  });

  it('generates a span of its own rather than reusing the parent', () => {
    const r = runEstateVerify({ gather: gathering(CLEAN), traceparent: TRACEPARENT });
    expect(r.event.span_id).not.toBe('00f067aa0ba902b7');
  });

  it('omits trace fields entirely when no parent supplied one', () => {
    const r = runEstateVerify({ gather: gathering(CLEAN) });
    expect('trace_id' in r.event).toBe(false);
  });
});

// A runtime gets the attestation without shelling out or re-rendering it.
describe('the statement travels with the result', () => {
  it('accompanies a verdict, bound to the same snapshot', () => {
    const r = runEstateVerify({ gather: gathering(CLEAN) });
    expect(r.statement?.subject[0]?.digest.sha256).toBe(estateDigest([CLEAN]));
  });

  it('is absent when there is no snapshot to make a claim about', () => {
    expect(runEstateVerify({ gather: () => ({ kind: 'git-failed' }) }).statement).toBeNull();
  });
});

// ---- a throw is UNKNOWN, never clean ----
// The try/catch in mainEstateVerify wrapped ONLY argv parsing, so anything
// thrown by gather or decide escaped: node printed a stack trace and the
// process exited 1 -- the code that means "readable estate, work in progress".
// A crash is not that. It is an estate nobody read.
//
// The sharper half is what a SUBSCRIBER saw. The contract is exactly one NDJSON
// event on stdout, and a crash emitted none at all. Fail-safe design is
// explicit that "the absence of a valid active signal defaults to the safe
// position" -- so silence must never be read as consent, and the only way to
// guarantee that is to always emit something.
//
// The boundary sits at the single entry point both surfaces use, so there is no
// path around it and no caller has to remember it.
describe('a throw is UNKNOWN, never clean', () => {
  const exploding = (): never => {
    throw new Error('gather blew up with /Users/secret/path in the message');
  };

  it('returns a result instead of propagating the throw', () => {
    expect(() => runEstateVerify({ gather: exploding })).not.toThrow();
  });

  it('reports the estate as unreadable, not as a verdict', () => {
    const r = runEstateVerify({ gather: exploding });
    expect(r.decision.kind).toBe('unreadable');
    expect(r.event['event.name']).toBe('fleet.estate.unreadable');
  });

  // Exit 3 is REPAIR_TOOLING. Exit 1 -- what a bare crash produced -- means a
  // readable estate with work in flight, which is a different and lesser claim.
  it('exits 3, the code for an estate that could not be read', () => {
    expect(runEstateVerify({ gather: exploding }).exitCode).toBe(3);
  });

  it('REFUSES to let the session close', () => {
    const r = runEstateVerify({ gather: exploding });
    expect(r.action).toBe('REPAIR_TOOLING');
    expect(r.mayProceed).toBe(false);
  });

  // A crash is OUR defect; git-failed is an expected operational condition with
  // a known remedy. Collapsing them would let a bug hide behind an excuse.
  it('names the defect as its own reason, distinct from a failed subprocess', () => {
    const r = runEstateVerify({ gather: exploding });
    if (r.event['event.name'] !== 'fleet.estate.unreadable') throw new Error('expected unreadable');
    expect(r.event.attributes.reason).toBe('threw');
  });

  it('still emits ONE schema-valid event, so a subscriber never sees silence', () => {
    const r = runEstateVerify({ gather: exploding });
    expect(EstateEventSchema.safeParse(r.event).success).toBe(true);
  });

  // The event is published, and an error message can quote a path, a branch or
  // subprocess output. The reason code says a defect occurred; the stack stays
  // on stderr where the operator reads it.
  it('leaks nothing from the error message into the published event', () => {
    const wire = JSON.stringify(runEstateVerify({ gather: exploding }).event);
    expect(wire).not.toContain('/Users/secret/path');
    expect(wire).not.toContain('blew up');
  });

  it('makes no attestation about an estate it never read', () => {
    expect(runEstateVerify({ gather: exploding }).statement).toBeNull();
  });

  // Correlation must survive the failure, or the one run an operator most needs
  // to find is the one that cannot be tied to its parent.
  it('keeps the caller trace context across the boundary', () => {
    const r = runEstateVerify({ gather: exploding, traceparent: TRACEPARENT });
    expect(r.event.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(r.event.parent_span_id).toBe('00f067aa0ba902b7');
  });

  // Not only Error: a throw can be any value at all, and a boundary that only
  // catches Error is a boundary with a hole in it.
  it('catches a thrown value that is not an Error', () => {
    for (const thrown of ['a string', 42, null, undefined, { odd: true }]) {
      // Throwing a non-Error is precisely the case under test: JavaScript
      // permits throwing any value, so a boundary catching only Error has a
      // hole. The rule is right about production code, not about this.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      const r = runEstateVerify({ gather: () => { throw thrown; } });
      expect(r.exitCode).toBe(3);
      expect(r.mayProceed).toBe(false);
    }
  });
});

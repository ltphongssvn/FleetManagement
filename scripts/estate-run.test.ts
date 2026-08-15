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
    const r = runEstateVerify({ gather: gathering(DIRTY) });
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
    const r = runEstateVerify({ gather: gathering(DIRTY) });
    expect(r.exitCode).toBe(r.decision.exitCode);
  });

  it('gives the action the event carries, never a recomputed one', () => {
    const r = runEstateVerify({ gather: gathering(BROKEN) });
    expect(r.action).toBe(r.decision.event.agent_action);
  });

  it('gives the same line the CLI prints', () => {
    const r = runEstateVerify({ gather: gathering(DIRTY) });
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
    const r = runEstateVerify({ gather: gathering(DIRTY) });
    const direct = decideEstate({ kind: 'states', states: [DIRTY], sourceDigest: SRC });
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

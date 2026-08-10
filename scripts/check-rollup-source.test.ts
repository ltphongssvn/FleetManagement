// scripts/check-rollup-source.test.ts
// RED->GREEN spec for classifyRollup: the pure core that tells "checks have not
// been created yet" apart from "the response did not match the schema".
//
// THE DEFECT. pr-automerge's listChecks did
//   return res.success ? res.data : null;
// which collapses Zod's success/failure discriminated union into one null. The
// polling loop then prints, for every null:
//   WAIT: could not parse statusCheckRollup; re-reading.
// On PR #530 that fired FIFTEEN times across two check cycles on a completely
// healthy run -- the rollup key simply did not exist yet, because GitHub had
// not created the check runs for the new head SHA.
//
// WHY THAT IS A DEFECT AND NOT COSMETIC. The same branch fires for a state that
// NEVER resolves: a fine-grained-PAT permissions failure makes gh return
// "Resource not accessible by personal access token" for statusCheckRollup
// (cli/cli#12597), and a gh output-shape change would do the same. Both spin to
// TIMEOUT emitting a message that says "re-reading" as though nothing were
// wrong. A real breakage is currently indistinguishable from a healthy poll.
//
// THE DISTINCTION IS AVAILABLE, NOT GUESSED. safeParse returns a discriminated
// union and the ZodError carries an issues array, one entry per failed field,
// each with path, message and code -- and the issue object is itself a
// discriminated union keyed on code. An absent rollup is an invalid_type issue
// at the root path; a malformed check run is an issue at a deeper path. So the
// classifier reads the error rather than discarding it.
//
// NOTE ON PENDING CHECKS. An in-flight check is NOT a parse failure: GitHub's
// status lifecycle is queued/pending/in_progress/expected -> completed, and only
// a completed check has a conclusion. CheckRunSchema already types conclusion as
// nullable, so those parse cleanly and are summarised as pending. This spec
// covers the layer above: whether the rollup itself is present at all.

import { describe, expect, it } from 'vitest';
import { classifyRollup, describeRollupFailure } from './check-rollup-source.ts';

describe('classifyRollup', () => {
  it('reports checks when the rollup holds parseable runs', () => {
    const r = classifyRollup(JSON.stringify({
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ],
    }));
    expect(r.kind, 'a well-formed rollup must classify as checks').toBe('checks');
    if (r.kind !== 'checks') return;
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]?.name).toBe('ci');
  });

  it('treats an in-flight run with a null conclusion as a check, not a failure', () => {
    const r = classifyRollup(JSON.stringify({
      statusCheckRollup: [
        { name: 'ci', status: 'IN_PROGRESS', conclusion: null },
      ],
    }));
    expect(
      r.kind,
      'status IN_PROGRESS with conclusion null is the documented pre-completion ' +
        'shape and must parse, not be reported as unparseable',
    ).toBe('checks');
  });

  it('reports none-yet when the rollup key is absent', () => {
    const r = classifyRollup(JSON.stringify({}));
    expect(
      r.kind,
      'GitHub omits statusCheckRollup before any check run exists for the head ' +
        'SHA; that is a normal early-poll state, not malformed data',
    ).toBe('none-yet');
  });

  it('reports none-yet when the rollup is null', () => {
    const r = classifyRollup(JSON.stringify({ statusCheckRollup: null }));
    expect(r.kind, 'a null rollup is an absent rollup').toBe('none-yet');
  });

  it('reports none-yet when the rollup is an empty array', () => {
    const r = classifyRollup(JSON.stringify({ statusCheckRollup: [] }));
    expect(
      r.kind,
      'an empty rollup means no checks registered yet -- distinct from garbage',
    ).toBe('none-yet');
  });

  it('reports unparseable when a run has the wrong shape', () => {
    const r = classifyRollup(JSON.stringify({
      statusCheckRollup: [{ name: 42, status: true }],
    }));
    expect(
      r.kind,
      'a run that violates CheckRunSchema is a real shape mismatch and must be ' +
        'surfaced, not silently retried as though checks were merely pending',
    ).toBe('unparseable');
  });

  it('carries the Zod issues when unparseable, so the reason is reportable', () => {
    const r = classifyRollup(JSON.stringify({
      statusCheckRollup: [{ name: 42, status: true }],
    }));
    if (r.kind !== 'unparseable') {
      // No trailing `return`: expect.unreachable is typed `never`, so the branch
      // already terminates and r narrows to the unparseable variant below. A
      // return here is TS7027 dead code -- the same workaround-outlived-its-bug
      // shape removed from gate-agent.ts and inspect-prod-deploy.ts in PR #532.
      expect.unreachable('expected unparseable');
    }
    expect(
      r.issues.length,
      'the ZodError issues array is what makes a shape mismatch diagnosable; ' +
        'discarding it is what left "could not parse" as the only signal',
    ).toBeGreaterThan(0);
    expect(r.issues[0]?.path).toBeDefined();
  });

  it('reports unparseable when the payload is not JSON at all', () => {
    const r = classifyRollup('Resource not accessible by personal access token');
    expect(
      r.kind,
      'a gh permissions error (cli/cli#12597) is not JSON and never resolves by ' +
        'waiting; it must be distinguishable from a pending rollup',
    ).toBe('unparseable');
  });

  it('reports unparseable when the rollup is a scalar', () => {
    const r = classifyRollup(JSON.stringify({ statusCheckRollup: 'nope' }));
    expect(r.kind, 'a scalar rollup is malformed, not absent').toBe('unparseable');
  });
});

// The message belongs to the CORE, not the shell. It began as a .map().join()
// inside pr-automerge's main(), where no unit test could reach it and the only
// way to cover it would have been to stub the gh subprocess -- which proves the
// test's model of gh, not gh. Here it is a deterministic function of its input.
describe('describeRollupFailure', () => {
  it('names every issue so the operator sees WHY, not merely THAT', () => {
    const msg = describeRollupFailure([
      { path: '0.name', code: 'invalid_type', message: 'expected string' },
      { path: '0.status', code: 'invalid_type', message: 'expected string' },
    ]);
    expect(msg).toContain('0.name');
    expect(msg).toContain('0.status');
    expect(msg).toContain('invalid_type');
  });

  it('states that retrying will not help, which is the operator decision', () => {
    const msg = describeRollupFailure([
      { path: '(root)', code: 'not_json', message: 'response was not JSON' },
    ]);
    expect(
      msg,
      'the whole point of separating unparseable from none-yet is that one ' +
        'resolves by waiting and the other never does; the message must say so',
    ).toContain('does not resolve by retrying');
  });

  it('degrades to a usable sentence when the issue list is empty', () => {
    const msg = describeRollupFailure([]);
    expect(
      msg.length,
      'an empty issue list must still produce a reportable line rather than a ' +
        'bare prefix with nothing after it',
    ).toBeGreaterThan(0);
    expect(msg).toContain('statusCheckRollup');
  });
});

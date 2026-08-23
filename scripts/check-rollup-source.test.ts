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
    const r = classifyRollup(
      JSON.stringify({
        statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      }),
    );
    expect(r.kind, 'a well-formed rollup must classify as checks').toBe('checks');
    if (r.kind !== 'checks') return;
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]?.name).toBe('ci');
  });

  it('treats an in-flight run with a null conclusion as a check, not a failure', () => {
    const r = classifyRollup(
      JSON.stringify({
        statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS', conclusion: null }],
      }),
    );
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
    expect(r.kind, 'an empty rollup means no checks registered yet -- distinct from garbage').toBe(
      'none-yet',
    );
  });

  it('reports unparseable when a run has the wrong shape', () => {
    const r = classifyRollup(
      JSON.stringify({
        statusCheckRollup: [{ name: 42, status: true }],
      }),
    );
    expect(
      r.kind,
      'a run that violates CheckRunSchema is a real shape mismatch and must be ' +
        'surfaced, not silently retried as though checks were merely pending',
    ).toBe('unparseable');
  });

  it('carries the Zod issues when unparseable, so the reason is reportable', () => {
    const r = classifyRollup(
      JSON.stringify({
        statusCheckRollup: [{ name: 42, status: true }],
      }),
    );
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

// ---- EXECUTION FAILURE IS NOT A CONTENT FAILURE ----
// pr:automerge exited 1 on PR #565 with:
//   BLOCKED -- statusCheckRollup did not match the expected shape, which does
//   not resolve by retrying: (root): not_json -- response was not JSON:
// Note the empty tail: gh produced NO bytes. The macOS gh TLS flake
// (cli/cli#13352) made the very next call fail with "x509: certificate signed
// by unknown authority" while curl to api.github.com returned 200 throughout --
// the chain was genuine, only gh's Go path faltered. Two retries later the same
// command succeeded, which is the definition of transient.
//
// unparseable's contract says it "does NOT resolve by waiting". It did.
//
// This is the SAME defect this file already fixed one layer up: joining stderr
// into stdout "meant a transient gh message landed in front of the JSON, and
// readRollup then classified it as unparseable -> exit 1, reporting a PERMANENT
// contract violation for a dropped connection". Splitting the streams removed
// the prefix and left the empty case behind.
//
// THE FIX IS NOT TO GUESS FROM THE STRING. A subprocess result is a TRIPLE --
// stdout, stderr, status -- and 2026 practice is to classify on the status,
// never to infer failure from output shape alone. Empty stdout with a non-zero
// exit is an EXECUTION failure (retry); a well-formed payload is a CONTENT
// question (parse it). Node/Bun even document binaries exiting 0 with empty
// stdout, "indistinguishable from a successful child that printed nothing", so
// an empty-with-exit-0 is treated as none-yet rather than an error.
describe('classifyRollup: execution failures are transient', () => {
  it('classifies empty stdout with a non-zero exit as unavailable', () => {
    expect(
      classifyRollup('', { exitCode: 1, stderr: 'x509: certificate signed by unknown authority' })
        .kind,
    ).toBe('unavailable');
  });

  it('carries the stderr so an operator can see WHY it was unavailable', () => {
    const c = classifyRollup('', { exitCode: 1, stderr: 'tls: failed to verify certificate' });
    if (c.kind !== 'unavailable') throw new Error('expected unavailable');
    expect(c.reason).toContain('tls');
  });

  // Exit 0 with no bytes is not an error: the documented ambiguous case.
  it('treats empty stdout with exit 0 as none-yet, not a failure', () => {
    expect(classifyRollup('', { exitCode: 0, stderr: '' }).kind).toBe('none-yet');
  });

  // A non-zero exit that still produced a valid payload is answered, not broken.
  it('prefers a well-formed payload over a non-zero exit', () => {
    expect(
      classifyRollup('{"statusCheckRollup":[]}', { exitCode: 1, stderr: 'warning' }).kind,
    ).toBe('none-yet');
  });

  // CONTENT failures stay terminal. Widening the transient bucket to cover
  // garbage would resurrect the spin-to-TIMEOUT-behind-a-reassuring-message bug
  // this module exists to kill.
  it('still classifies non-empty garbage as unparseable', () => {
    expect(
      classifyRollup('Resource not accessible by personal access token', {
        exitCode: 1,
        stderr: '',
      }).kind,
    ).toBe('unparseable');
  });

  // Back-compat: the options argument is optional, so existing callers and the
  // cases above keep their meaning.
  it('defaults to the content-only reading when no exec context is given', () => {
    expect(classifyRollup('{"statusCheckRollup":[]}').kind).toBe('none-yet');
    expect(classifyRollup('42').kind).toBe('unparseable');
  });
});

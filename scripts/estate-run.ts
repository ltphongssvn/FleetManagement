// scripts/estate-run.ts
// THE ENVELOPE: one call from a request to a result, with no transport in it.
//
// WHY THIS EXISTS. decideEstate was pure and importable, but the step BEFORE it
// -- spawn git, parse porcelain, build states -- lived module-private inside
// estate-verify-cli.ts, under a v8-ignore, fused into a main() that also read
// process.argv, wrote two streams and returned an exit code. So the path from
// "a repo on disk" to an EstateDecision was reachable only by SPAWNING THE
// PROCESS.
//
// That left an in-process agent runtime two options and both are bad: shell out
// and parse stdout, or import decideEstate and re-implement gathering. 2026
// guidance names the second failure exactly -- "the capability belongs in a
// library or service; the surface just exposes it", because logic placed in one
// surface "is duplicated when they add the [other], and the two drift".
//
// So the capability moves here and BOTH surfaces get thin. The CLI keeps argv,
// stdout, stderr and the exit code, which is all a CLI should own. A runtime
// calls runEstateVerify directly and reads the same fields the CLI prints.
//
// NO NEW TRANSPORT. Not an MCP server: the guidance is equally clear that a
// well-built CLI already serves any agent, any shell and any CI job, while an
// MCP host pays a context tax loading tool schemas every turn. What was missing
// was never a protocol -- it was an exported function.
//
// GATHERING IS INJECTED, not imported. The runner takes the git reader as a
// parameter, so this module spawns nothing and stays testable without a repo,
// and a caller that already holds the states (a replay, a simulation, a
// different VCS) drives the same decision path.
import type { Digest } from './estate-verify.js';
import {
  decideEstate,
  unreadableEstateEvent,
  describeEstate,
  spanContextFor,
  traceContextFrom,
  type EstateDecision,
  type EstateEvent,
  type EstateGathered,
} from './estate-verify.js';
import { estateStatement, type EstateStatement } from './estate-attestation.js';
import { exitCodeFor, mayProceed, type EstateAction } from './estate-action.js';

/** What a caller asks for. Every field is data: no argv, no environment, no
 *  streams. The CLI derives this from argv; a runtime builds it directly. */
export interface EstateRunRequest {
  /** Learn what git has to say. Injected so this module spawns nothing. */
  readonly gather: () => EstateGathered;
  /** If-Match: act only if the estate is still this digest. */
  readonly expectDigest?: Digest | null;
  /** A W3C traceparent from the parent, when one exists. Passed as a VALUE
   *  rather than read from the environment, so a runtime holding a trace in
   *  memory does not have to stuff it into process.env to be heard. */
  readonly traceparent?: string | undefined;
  /** The clock, INJECTED. Defaults to the real one so a caller need not care,
   *  but a test pins it and the pure core never reads it. This is the same
   *  seam gather uses, for the same reason. */
  readonly now?: () => string;
}

/** Everything either surface needs, computed once.
 *
 *  The CLI prints `event` to stdout and `line` to stderr and exits with
 *  `exitCode`. A runtime reads `action`, `mayProceed` and `statement`. Neither
 *  re-derives anything: a second derivation is how two surfaces come to
 *  disagree about the same run. */
export interface EstateRunResult {
  /** The NDJSON event, exactly as the CLI writes it. */
  readonly event: EstateEvent;
  /** The graded exit code: 0 clean, 1 not clean, 3 unreadable, 4 stale. */
  readonly exitCode: 0 | 1 | 3 | 4;
  /** The human line, so a runtime can surface the same words an operator sees
   *  rather than composing its own and drifting from the CLI's wording. */
  readonly line: string;
  /** ADVISORY. What the tool recommends; never permission to act. */
  readonly action: EstateAction;
  /** The session-closed contract as a value, so no consumer re-implements it. */
  readonly mayProceed: boolean;
  /** The in-toto Statement when a verdict was reached, else null. Unsigned. */
  readonly statement: EstateStatement | null;
  /** The full decision, for a caller that needs the verdict itself. */
  readonly decision: EstateDecision;
}

/** Gather, decide, and render -- once, for whoever asked.
 *
 *  PURE given its gather function: no argv, no environment, no stdout, no
 *  clock. That is what makes the CLI's own behaviour testable without spawning
 *  git, which the v8-ignore around mainEstateVerify previously made impossible. */
export function runEstateVerify(request: EstateRunRequest): EstateRunResult {
  const trace = spanContextFor(traceContextFrom(request.traceparent));
  const at = (request.now ?? (() => new Date().toISOString()))();
  let decision: EstateDecision;
  try {
    decision = decideEstate(request.gather(), trace, request.expectDigest ?? null, at);
  } catch {
    // FAIL CLOSED. Anything that escapes gather or decide is a defect, and a
    // defect means the estate is UNKNOWN -- never clean. Without this the
    // throw escaped mainEstateVerify, node printed a stack trace, and the
    // process exited 1: the code that means "readable estate, work in
    // progress". Worse, the contract is exactly one NDJSON event on stdout and
    // a crash emitted NONE, so a subscriber saw silence -- and the fail-safe
    // principle is that the absence of a valid signal must default to the safe
    // position, not to consent.
    //
    // The boundary lives HERE, at the single entry point both surfaces use, so
    // there is no path around it and no caller has to remember it.
    //
    // The error itself is deliberately NOT carried into the event: a message
    // may quote a path, a branch or subprocess output, and this event is
    // published. The reason code says a defect occurred; the stack belongs on
    // stderr where the operator reads it.
    decision = {
      kind: 'unreadable',
      event: unreadableEstateEvent('threw', at, trace),
      exitCode: exitCodeFor('REPAIR_TOOLING'),
    };
  }
  const action = decision.event.agent_action;
  return {
    event: decision.event,
    exitCode: decision.exitCode,
    line: estateLineFor(decision),
    action,
    mayProceed: mayProceed(action),
    statement: estateStatement(decision),
    decision,
  };
}

/** The human line, chosen by the decision's own discriminant.
 *
 *  No default and no fallback: the switch is exhaustive over EstateDecision, so
 *  a new variant is a COMPILE error here rather than a silent fall-through to a
 *  "should never happen" string. */
export function estateLineFor(decision: EstateDecision): string {
  switch (decision.kind) {
    case 'stale':
      // Named separately because the remediation differs: nothing is broken and
      // no worktree needs attention -- the caller's view is out of date, and the
      // fix is to re-read, exactly as a 412 tells a client to re-fetch.
      return 'estate STALE: expected '
        + decision.event.attributes.expected_digest.slice(0, 12)
        + ', found ' + decision.event.attributes.estate_digest.slice(0, 12);
    case 'unreadable':
      return 'estate UNREADABLE: ' + decision.event.attributes.reason;
    case 'verified':
      return describeEstate(decision.verdict);
  }
}

// scripts/check-rollup-source.ts
// Pure classifier for a `gh pr view --json statusCheckRollup` invocation.
//
// THE DEFECT THIS FIXES. pr-automerge's listChecks did
//   return res.success ? res.data : null;
// collapsing Zod's success/failure discriminated union into a single null. The
// polling loop printed, for every null:
//   WAIT: could not parse statusCheckRollup; re-reading.
// On PR #530 that fired FIFTEEN times across two check cycles on a healthy run:
// the rollup key simply did not exist yet, because GitHub had not created check
// runs for the new head SHA. Nothing was unparseable; nothing needed reporting.
//
// WHY IT MATTERS. The same branch fires for states that NEVER resolve. A
// fine-grained-PAT permissions failure makes gh emit "Resource not accessible
// by personal access token" instead of JSON (cli/cli#12597), and any gh
// output-shape change does likewise. Both spin to TIMEOUT while printing a
// message that says "re-reading", as though the run were fine. A poll loop
// whose NOT-READY state is indistinguishable from its BROKEN state has no clear
// failure mode -- and retries that mask the initial error context hide the root
// cause in the logs. Transient failures are retried; PERMANENT ones (auth,
// contract violations) must be surfaced, because retrying cannot fix them.
//
// THE DISTINCTION IS READ, NOT GUESSED. safeParse returns a discriminated union
// and its ZodError carries an issues array -- one entry per failed field, each
// with path, message and code, the issue itself discriminated on code. So an
// absent rollup and a malformed run are separable facts, and the classifier
// keeps the issues so the caller can report WHY rather than merely THAT.
//
// PENDING IS NOT A PARSE FAILURE. GitHub's lifecycle is
// queued/pending/in_progress/expected -> completed, and only a completed check
// has a conclusion; CheckRunSchema already types conclusion as nullable, so
// in-flight runs parse cleanly and summarise as pending. This module sits one
// layer above that: whether the rollup exists at all.
//
// EXECUTION FAILURE IS NOT CONTENT FAILURE (the fourth state). pr:automerge
// exited 1 on PR #565 with
//   BLOCKED -- ... does not resolve by retrying: (root): not_json -- response
//   was not JSON:
// and an EMPTY tail: gh produced no bytes. The macOS gh TLS flake
// (cli/cli#13352) made the next call fail with "x509: certificate signed by
// unknown authority" while curl to api.github.com returned 200 throughout, and
// two retries later the same command succeeded. It resolved by waiting, which
// is precisely what `unparseable` promises cannot happen.
//
// That is the SAME defect this file already fixed one layer up. Joining stderr
// into stdout "meant a transient gh message landed in front of the JSON, and
// readRollup then classified it as unparseable -> exit 1, reporting a PERMANENT
// contract violation for a dropped connection." Splitting the streams removed
// the prefix and left the empty case behind.
//
// So the caller now passes the whole subprocess RESULT, not just a string: a
// process outcome is a triple (stdout, stderr, status), and classifying on the
// status is the 2026 convention -- never infer failure from output shape alone.
// Empty stdout with a NON-ZERO exit is an execution failure and is retried;
// empty stdout with exit 0 is the documented ambiguous case (Node and Bun both
// note binaries that exit 0 having printed nothing, "indistinguishable from a
// successful child that printed nothing"), so it stays none-yet rather than
// becoming a spurious error. A well-formed payload wins regardless of exit
// code: gh warns on stderr and still answers.
//
// The exec context is OPTIONAL so a caller with only a string keeps the
// content-only reading, and every existing test keeps its meaning.

import { z } from 'zod';
import { CheckRunSchema, type CheckRun } from './check-conclusion.ts';

/** A rollup that is present and well-formed. */
export interface RollupChecks {
  readonly kind: 'checks';
  readonly runs: readonly CheckRun[];
}

/**
 * No check runs exist yet for this head SHA. A normal early-poll state: GitHub
 * omits the key, nulls it, or returns an empty array before creating runs.
 * Resolves by waiting.
 */
export interface RollupNoneYet {
  readonly kind: 'none-yet';
}

/**
 * The gh invocation itself did not produce an answer -- no stdout and a
 * non-zero exit. A dropped connection, a TLS flake, a killed process. TRANSIENT:
 * resolves by retrying, and must never be reported as a contract violation.
 */
export interface RollupUnavailable {
  readonly kind: 'unavailable';
  readonly reason: string;
}

/**
 * The payload did not match the schema: not JSON at all, a scalar where an
 * array belongs, or a run violating CheckRunSchema. Does NOT resolve by
 * waiting, and carries the issues so the caller can say what broke.
 */
export interface RollupUnparseable {
  readonly kind: 'unparseable';
  readonly issues: readonly RollupIssue[];
}

export interface RollupIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type RollupClassification =
  | RollupChecks
  | RollupNoneYet
  | RollupUnavailable
  | RollupUnparseable;

/** How the gh subprocess ended. Optional: absent means classify on content. */
export interface RollupExec {
  readonly exitCode: number;
  readonly stderr: string;
}

const CheckListSchema = z.array(CheckRunSchema);

function issuesFrom(error: z.ZodError): readonly RollupIssue[] {
  return error.issues.map((i) => ({
    path: i.path.join('.') || '(root)',
    code: i.code,
    message: i.message,
  }));
}

/**
 * Render an unparseable classification as one operator-facing line.
 *
 * PURE, AND IN THE CORE ON PURPOSE. This began as a .map().join() inside
 * pr-automerge's main() -- the imperative SHELL, where the rule is
 * orchestration only: no business rules, no formatting decisions, nothing that
 * needs its own test. Logic there is invisible to the exhaustive unit tests the
 * core already carries, and the only way to cover it would be to stub the gh
 * subprocess, which proves the test's model of gh rather than gh itself.
 *
 * Here it is a deterministic function of the issues, testable with zero I/O,
 * and the shell shrinks to write(describeRollupFailure(...)) + return 1.
 */
export function describeRollupFailure(issues: readonly RollupIssue[]): string {
  if (issues.length === 0) {
    return 'statusCheckRollup did not match the expected shape (no issues reported)';
  }
  return (
    'statusCheckRollup did not match the expected shape, which does not ' +
    'resolve by retrying: ' +
    issues.map((i) => i.path + ': ' + i.code + ' -- ' + i.message).join('; ')
  );
}

/**
 * Classify one `gh pr view --json statusCheckRollup` invocation.
 *
 * Absent / null / empty-array are all none-yet: GitHub expresses "no runs
 * created" in each of those ways depending on timing, and none is malformed.
 * Empty stdout with a non-zero exit is unavailable (transient). Everything else
 * that fails the schema is unparseable, with issues attached.
 */
export function classifyRollup(raw: string, exec?: RollupExec): RollupClassification {
  // Order matters: an EXECUTION failure is decided before any attempt to read
  // content, because there is no content to read and JSON.parse('') would
  // otherwise mis-file it as a contract violation.
  if (raw.trim().length === 0) {
    if (exec !== undefined && exec.exitCode !== 0) {
      const why = exec.stderr.trim();
      return {
        kind: 'unavailable',
        reason:
          'gh exited ' +
          String(exec.exitCode) +
          ' with no output' +
          (why.length > 0 ? ': ' + why.slice(0, 200) : ''),
      };
    }
    // Exit 0 (or unknown) with no bytes: ambiguous by documentation, so treat it
    // as "nothing to report yet" and poll again rather than fail the run.
    return { kind: 'none-yet' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      kind: 'unparseable',
      issues: [
        {
          path: '(root)',
          code: 'not_json',
          message: 'response was not JSON: ' + raw.slice(0, 200),
        },
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      kind: 'unparseable',
      issues: [
        {
          path: '(root)',
          code: 'invalid_type',
          message: 'expected an object from gh --json',
        },
      ],
    };
  }

  const rollup = (parsed as Record<string, unknown>)['statusCheckRollup'];
  if (rollup === undefined || rollup === null) return { kind: 'none-yet' };

  const res = CheckListSchema.safeParse(rollup);
  if (!res.success) return { kind: 'unparseable', issues: issuesFrom(res.error) };
  if (res.data.length === 0) return { kind: 'none-yet' };
  return { kind: 'checks', runs: res.data };
}

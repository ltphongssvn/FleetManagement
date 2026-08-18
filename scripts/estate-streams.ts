// scripts/estate-streams.ts
// WHICH BYTES GO TO WHICH STREAM. Pure, so the contract that makes this task
// machine-consumable is testable without spawning a process.
//
// THE CONTRACT. Exactly one NDJSON line on stdout and nothing else; the human
// sentence on stderr. 2026 CLI guidance states it as a rule -- stdout is the
// product, stderr is the commentary, and "one object per line is what makes a
// structured stream readable before it ends". A caller pipes stdout to jq
// without stripping prose, and branches on the graded exit rather than scraping
// English.
//
// WHY IT WAS UNTESTED, AND WHY THAT MATTERED. The two writes lived inside
// mainEstateVerify under a v8-ignore, so nothing asserted the split. A debug
// print, a stray console.log, or a dependency banner would have put a second
// line on stdout and broken every jq consumer, with no test to catch it.
//
// AND IT IS A SECURITY PROPERTY, not tidiness. In May 2026 a widely used test
// framework shipped a release that wrote agent-targeted instructions to stdout,
// erased from a human terminal by ANSI escapes but "fully visible to automated
// tooling" -- CI logs, IDE panels, an agent's tool output. The lesson drawn was
// that any dependency producing stdout text is now an injection vector. A tool
// whose stdout is EXACTLY one machine-readable line, asserted, is one that
// cannot carry such a payload without a test failing.
import type { EstateRunResult } from './estate-run.js';

const NL = String.fromCharCode(10);

/** The bytes destined for each stream. Strings, not writes: the caller decides
 *  where they go, which is what makes the split assertable. */
export interface EstateStreams {
  /** Exactly one NDJSON line, newline-terminated. Never empty, never two. */
  readonly stdout: string;
  /** The operator sentence, or empty under --quiet. Never machine-read. */
  readonly stderr: string;
}

/** Render one run onto the two streams.
 *
 *  --quiet silences the PROSE only. The event still goes to stdout, because a
 *  caller asking for quiet wants less commentary, not less data -- and a run
 *  that emitted nothing at all would be indistinguishable from one that never
 *  happened, which is the confident-zero hazard this task exists to refuse. */
export function estateStreams(
  result: EstateRunResult,
  quiet = false,
): EstateStreams {
  return {
    // JSON.stringify, never a hand-built string: a serialiser that escapes
    // nothing is how a path containing a quote breaks the line contract.
    stdout: JSON.stringify(result.event) + NL,
    stderr: quiet ? '' : result.line + NL,
  };
}

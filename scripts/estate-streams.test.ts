// scripts/estate-streams.test.ts
// The contract that makes this task machine-consumable, asserted at last.
//
// WHY IT WAS UNTESTED. The two writes lived inside mainEstateVerify under a
// v8-ignore, so nothing checked which bytes went to which stream. A debug
// print, a stray console.log or a dependency banner would have put a second
// line on stdout and broken every jq consumer, silently.
//
// AND IT IS A SECURITY PROPERTY. In May 2026 a widely used test framework
// shipped a release writing agent-targeted instructions to stdout, hidden from
// a human terminal by ANSI escapes but fully visible to automated tooling --
// CI logs, IDE panels, an agent's tool output. The lesson drawn was that any
// dependency producing stdout text is now an injection vector. A tool whose
// stdout is EXACTLY one machine-readable line, asserted, cannot carry such a
// payload without a test failing.
import { describe, it, expect } from 'vitest';
import { estateStreams, type EstateStreams } from './estate-streams.js';
import { runEstateVerify } from './estate-run.js';
import {
  EstateEventSchema,
  createWorktreeState,
  digestOf,
  type EstateGathered,
} from './estate-verify.js';

const CLEAN = createWorktreeState({ path: '/c/a', branch: 'x' });
const DIRTY = createWorktreeState({ path: '/c/b', dirtyFileCount: 2 });
const SRC = digestOf('worktree /c/a');
const NL = String.fromCharCode(10);

function streamsFor(
  ...states: readonly ReturnType<typeof createWorktreeState>[]
): EstateStreams {
  return estateStreams(runEstateVerify({
    gather: (): EstateGathered => ({ kind: 'states', states, sourceDigest: SRC }),
  }));
}

/** The lines actually written, with the trailing newline removed. */
function lines(chunk: string): readonly string[] {
  return chunk.endsWith(NL) ? chunk.slice(0, -NL.length).split(NL) : chunk.split(NL);
}

describe('stdout carries EXACTLY one line, and it is JSON', () => {
  it('writes one line for a clean estate', () => {
    expect(lines(streamsFor(CLEAN).stdout)).toHaveLength(1);
  });

  it('writes one line for an unclean estate, however many problems', () => {
    expect(lines(streamsFor(CLEAN, DIRTY).stdout)).toHaveLength(1);
  });

  it('writes one line for every unreadable outcome', () => {
    for (const kind of ['git-failed', 'no-records', 'record-rejected'] as const) {
      const s = estateStreams(runEstateVerify({
        gather: (): EstateGathered =>
          kind === 'git-failed' ? { kind } : { kind, sourceDigest: SRC },
      }));
      expect(lines(s.stdout)).toHaveLength(1);
    }
  });

  // The fail-closed boundary must not break the line contract either: a crash
  // still emits one event, because silence would read as consent.
  it('writes one line even when the classifier throws', () => {
    const s = estateStreams(runEstateVerify({
      gather: () => { throw new Error('boom'); },
    }));
    expect(lines(s.stdout)).toHaveLength(1);
  });

  it('terminates the line with a newline, as NDJSON requires', () => {
    expect(streamsFor(CLEAN).stdout.endsWith(NL)).toBe(true);
  });

  it('parses as JSON and satisfies the published contract', () => {
    const parsed: unknown = JSON.parse(streamsFor(CLEAN, DIRTY).stdout);
    expect(EstateEventSchema.safeParse(parsed).success).toBe(true);
  });

  // A path carrying a quote or a newline must not break the line contract --
  // which is why the event is serialised, never assembled by hand.
  it('escapes a branch name that would otherwise split the line', () => {
    const awkward = createWorktreeState({
      path: '/c/odd', branch: 'feat/"quoted"', dirtyFileCount: 1,
    });
    expect(lines(streamsFor(awkward).stdout)).toHaveLength(1);
    expect(EstateEventSchema.safeParse(JSON.parse(streamsFor(awkward).stdout)).success)
      .toBe(true);
  });
});

describe('stdout carries NOTHING a machine cannot parse', () => {
  it('emits no prose, no banner, no leading text', () => {
    const out = streamsFor(CLEAN, DIRTY).stdout;
    expect(out.startsWith('{')).toBe(true);
    expect(() => JSON.parse(out) as unknown).not.toThrow();
  });

  // ANSI is how the 2026 protestware case hid its payload from a human
  // terminal while leaving it visible to an agent reading captured output.
  it('emits no ANSI escape sequence', () => {
    const out = streamsFor(CLEAN, DIRTY).stdout;
    expect(out.includes(String.fromCharCode(27))).toBe(false);
  });

  it('emits no control characters other than the terminating newline', () => {
    const body = streamsFor(CLEAN, DIRTY).stdout.slice(0, -NL.length);
    for (let i = 0; i < body.length; i += 1) {
      const code = body.charCodeAt(i);
      expect(code < 0x20 || code === 0x7f).toBe(false);
    }
  });

  it('never carries the human sentence, which belongs on stderr', () => {
    const s = streamsFor(CLEAN, DIRTY);
    expect(s.stdout).not.toContain('estate NOT clean');
    expect(s.stderr).toContain('estate NOT clean');
  });
});

describe('stderr is commentary, and --quiet silences only that', () => {
  it('writes the operator line by default', () => {
    expect(streamsFor(CLEAN).stderr.trim().length).toBeGreaterThan(0);
  });

  it('writes NOTHING to stderr under --quiet', () => {
    const s = estateStreams(runEstateVerify({
      gather: (): EstateGathered => ({ kind: 'states', states: [CLEAN], sourceDigest: SRC }),
    }), true);
    expect(s.stderr).toBe('');
  });

  // --quiet asks for less commentary, not less data. A run that emitted nothing
  // would be indistinguishable from one that never happened -- the confident
  // zero this whole task exists to refuse.
  it('still writes the event to stdout under --quiet', () => {
    const s = estateStreams(runEstateVerify({
      gather: (): EstateGathered => ({ kind: 'states', states: [CLEAN], sourceDigest: SRC }),
    }), true);
    expect(lines(s.stdout)).toHaveLength(1);
    expect(EstateEventSchema.safeParse(JSON.parse(s.stdout)).success).toBe(true);
  });
});

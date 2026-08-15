// scripts/estate-verify.test.ts
// RED: assert the estate is CLEAN as a captured task, not three commands read
// by human eyes.
//
// WHY. Closing a session I ran `git worktree list`, `git stash list` and
// `git status --porcelain` by hand and declared the estate clean. That is the
// shape worktree:close describes retiring -- "a hand-rolled git idiom, not a
// captured op" -- and it very nearly shipped a false report: the SWEEP's
// `unmerged` refusal, not my three commands, is what revealed PR #565 was still
// OPEN after I had summarised it as deployed.
//
// FOUR PROPERTIES, not the three I checked. `git worktree list --porcelain`
// also reports `prunable` ("gitdir file points to non-existent location") and
// `locked`. A stale worktree is a real defect -- GitLab records that "git 2.16
// will fail badly if there are stale worktrees" -- and my hand check could not
// see one at all.
//
// EVERY REASON, NAMED. GitLab's sibling failure was a cleanup that returned
// "only the error code ... which made it difficult to diagnose". One line per
// worktree carrying ALL its reasons, never just the first, or the operator goes
// round the loop once per problem.
import { describe, it, expect } from 'vitest';
import {
  classifyEstate,
  describeEstate,
  createWorktreeState,
  estateTelemetry,
  WorktreeStateSchema,
  toWorktreeState,
  severityFor,
  traceContextFrom,
  spanContextFor,
  newSpanId,
  estateDigest,
  digestOf,
  DigestSchema,
  REASON_KIND,
  kindsFor,
  ESTATE_REASONS,
  unreadableEstateEvent,
  UNREADABLE_REASONS,
  decideEstate,
  ESTATE_SCHEMA_VERSION,
  EstateEventSchema,
  REASON_KINDS,
  SEVERITY_TEXTS,
  SEVERITY_NUMBERS,
  estateStaleEvent,
  type EstateReason,
} from './estate-verify.ts';

// Built THROUGH the schema, never a hand-written literal typed against an
// interface. A literal only agrees with the type at COMPILE time, so it drifts
// silently the moment the schema gains a field -- which is not hypothetical
// here: admin-drivers-client fixtures omitted six required fields and passed
// only because the call site cast instead of parsing.
const CLEAN = createWorktreeState({ path: '/c/t1-wt1-x', branch: 'feat/x' });

// Every verdict is ABOUT a snapshot, so every verified event carries that
// snapshot's address. The digest is required now rather than optional: a
// recommendation whose evidence cannot be named is one no downstream policy
// decision point could re-verify, and re-verification is exactly what
// --expect-digest exists to make possible.
const DIGEST = estateDigest([CLEAN]);

// A FIXED instant. The events now carry a timestamp, and a test that read the
// real clock would make the byte-identical-event assertions flap. Pinning it is
// exactly why the clock is injected rather than read inside the core.
const AT = '2026-01-01T00:00:00.000Z';

// The rendering is multi-line, so asserting the WHOLE sentence makes the
// separator part of the contract too.
const NL = String.fromCharCode(10);

/** Expected reason lists, TYPED against the vocabulary. A bare string array
 *  lets a typo like 'dirtyy' compile and fail at runtime with a confusing
 *  diff; this makes it a COMPILE error, which is where a misspelled member
 *  belongs. */
function reasons(...rs: readonly EstateReason[]): readonly EstateReason[] {
  return rs;
}


describe('classifyEstate', () => {
  it('reports clean when every worktree is clean', () => {
    const v = classifyEstate([CLEAN]);
    expect(v.clean).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it('an empty estate is clean, not an error', () => {
    expect(classifyEstate([]).clean).toBe(true);
  });

  it('flags a dirty working tree', () => {
    const v = classifyEstate([{ ...CLEAN, dirtyFileCount: 3 }]);
    expect(v.clean).toBe(false);
    expect(v.problems[0]?.reasons).toContain('dirty');
  });

  it('flags unpushed commits', () => {
    expect(classifyEstate([{ ...CLEAN, aheadOfRemote: 2 }]).problems[0]?.reasons)
      .toContain('unpushed');
  });

  it('flags a stash', () => {
    expect(classifyEstate([{ ...CLEAN, stashCount: 1 }]).problems[0]?.reasons)
      .toContain('stash');
  });

  // The property the hand check could not see.
  it('flags a prunable (stale) worktree', () => {
    expect(classifyEstate([{ ...CLEAN, prunable: true }]).problems[0]?.reasons)
      .toContain('prunable');
  });

  it('flags a locked worktree', () => {
    expect(classifyEstate([{ ...CLEAN, locked: true }]).problems[0]?.reasons)
      .toContain('locked');
  });

  it('reports every reason for one worktree at once', () => {
    const v = classifyEstate([
      { ...CLEAN, dirtyFileCount: 1, aheadOfRemote: 1, stashCount: 1 },
    ]);
    expect(v.problems[0]?.reasons).toEqual(reasons('dirty', 'unpushed', 'stash'));
  });

  it('reports every unclean worktree, not just the first', () => {
    const v = classifyEstate([
      { ...CLEAN, path: '/c/a', dirtyFileCount: 1 },
      CLEAN,
      { ...CLEAN, path: '/c/b', stashCount: 1 },
    ]);
    expect(v.problems.map((p) => p.path)).toEqual(['/c/a', '/c/b']);
  });
});

// ---- the whole sentence, not a substring of it ----
// `toContain("2")` passed on ANY string containing a 2 -- "12", "2026", or a
// count that was simply wrong. That is the weak assertion mutation testing
// exists to expose: the test ran the function and checked almost nothing, so a
// defect in the count would have shipped green. Exact equality is the strongest
// form; substring matchers are for when a PATTERN, not a value, is the point.
describe("describeEstate", () => {
  it("renders the failure line in full, worktree, branch and reasons", () => {
    expect(describeEstate(classifyEstate([{ ...CLEAN, dirtyFileCount: 2 }]))).toBe(
      "estate NOT clean: 1 of 1 worktree(s)" + NL +
      "  /c/t1-wt1-x [feat/x] (dirty)",
    );
  });

  it("names EVERY reason on the line, comma separated", () => {
    expect(describeEstate(classifyEstate([
      { ...CLEAN, dirtyFileCount: 1, aheadOfRemote: 1, stashCount: 1 },
    ]))).toBe(
      "estate NOT clean: 1 of 1 worktree(s)" + NL +
      "  /c/t1-wt1-x [feat/x] (dirty,unpushed,stash)",
    );
  });

  it("gives one line per unclean worktree, and none for the clean ones", () => {
    expect(describeEstate(classifyEstate([
      { ...CLEAN, path: "/c/a", dirtyFileCount: 1 },
      CLEAN,
      { ...CLEAN, path: "/c/b", stashCount: 1 },
    ]))).toBe(
      "estate NOT clean: 2 of 3 worktree(s)" + NL +
      "  /c/a [feat/x] (dirty)" + NL +
      "  /c/b [feat/x] (stash)",
    );
  });

  // The count is the whole point: a bare OK cannot be told apart from a run
  // that examined nothing. Asserting the SENTENCE means a wrong count fails,
  // which toContain("2") did not.
  it("states how many were checked on success, never a bare OK", () => {
    expect(describeEstate(classifyEstate([CLEAN, CLEAN]))).toBe(
      "estate clean: 2 worktree(s) checked, no dirty tree, " +
      "no unpushed commits, no stash, none stale or locked",
    );
  });

  it("counts an empty estate as zero rather than omitting the count", () => {
    expect(describeEstate(classifyEstate([]))).toBe(
      "estate clean: 0 worktree(s) checked, no dirty tree, " +
      "no unpushed commits, no stash, none stale or locked",
    );
  });
});

// The fixture is only trustworthy if it is provably the runtime shape. These
// pin that the test boundary and the parse boundary are the SAME boundary.
describe('createWorktreeState: fixtures cannot drift from the contract', () => {
  it('produces a state that satisfies the schema', () => {
    expect(WorktreeStateSchema.safeParse(createWorktreeState()).success).toBe(true);
  });

  it('still satisfies the schema after an override', () => {
    const s = createWorktreeState({ dirtyFileCount: 4, locked: true });
    expect(WorktreeStateSchema.safeParse(s).success).toBe(true);
  });

  // Overrides are parsed, not merged blindly: a caller cannot manufacture a
  // state no git output could produce, which is the whole point of the factory.
  it('THROWS on an override that violates the contract', () => {
    expect(() => createWorktreeState({ dirtyFileCount: -1 })).toThrow();
    expect(() => createWorktreeState({ path: '' })).toThrow();
    expect(() => createWorktreeState({ prunable: 'yes' as unknown as boolean })).toThrow();
  });

  it('rejects a non-integer count, since git reports whole files', () => {
    expect(() => createWorktreeState({ aheadOfRemote: 1.5 })).toThrow();
  });
});

// ---- structured truth, not prose to be parsed ----
// describeEstate returns a sentence. An orchestrator routing on this task must
// never read English to learn whether the estate is clean -- that is the
// failure gate:agent already names, emitting NDJSON per state transition so a
// consumer never scrapes stdout, and the rule eas-build-freshness.ts states for
// its own verdict: machine consumers read the fields, and the prose is DERIVED
// from the same verdict rather than parsed back out of it.
describe('estateTelemetry', () => {
  it('reports a clean estate as structured fields', () => {
    const t = estateTelemetry(classifyEstate([CLEAN, CLEAN]), null, DIGEST, AT);
    expect(t["event.name"]).toBe("fleet.estate.verified");
    expect(t.attributes.clean).toBe(true);
    expect(t.attributes.checked).toBe(2);
    expect(t.attributes.unclean_count).toBe(0);
    expect(t.attributes.reasons).toEqual([]);
  });

  it('surfaces a flat reason set a consumer can route on', () => {
    const t = estateTelemetry(classifyEstate([
      createWorktreeState({ path: '/c/a', dirtyFileCount: 1 }),
      createWorktreeState({ path: '/c/b', prunable: true }),
    ]), null, DIGEST, AT);
    expect(t.attributes.clean).toBe(false);
    expect(t.attributes.unclean_count).toBe(2);
    expect(t.attributes.reasons).toEqual(reasons("dirty", "prunable"));
  });

  it('de-duplicates a reason shared by several worktrees', () => {
    const t = estateTelemetry(classifyEstate([
      createWorktreeState({ path: '/c/a', stashCount: 1 }),
      createWorktreeState({ path: '/c/b', stashCount: 2 }),
    ]), null, DIGEST, AT);
    expect(t.attributes.reasons).toEqual(reasons("stash"));
  });

  // Declaration order, never walk order: a consumer diffing two runs must not
  // see a change because the estate happened to be enumerated differently.
  it('orders reasons by declaration, not by discovery', () => {
    const t = estateTelemetry(classifyEstate([
      createWorktreeState({ path: '/c/a', locked: true }),
      createWorktreeState({ path: '/c/b', dirtyFileCount: 1 }),
    ]), null, DIGEST, AT);
    expect(t.attributes.reasons).toEqual(reasons("dirty", "locked"));
  });

  // The whole point: prose and telemetry must never disagree, because they are
  // two renderings of ONE verdict.
  it('agrees with the prose rendering of the same verdict', () => {
    const v = classifyEstate([createWorktreeState({ dirtyFileCount: 1 })]);
    const t = estateTelemetry(v, null, DIGEST, AT);
    expect(t.attributes.clean).toBe(v.clean);
    expect(describeEstate(v).includes("NOT clean")).not.toBe(t.attributes.clean);
  });

  it('serialises to JSON without loss', () => {
    const t = estateTelemetry(classifyEstate([createWorktreeState({ stashCount: 1 })]), null, DIGEST, AT);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

// ---- the path is a cwd, so the boundary decides what may become one ----
// Injection is already closed one layer down: every git call is execFileSync
// with an argv ARRAY and no shell, the documented single-API fix. These pin the
// defence in depth every 2026 source recommends ON TOP of that, and one real
// correctness hazard: porcelain output is LINE-ORIENTED, so a path containing a
// newline silently desynchronises the parse rather than merely looking odd.
// Git escapes and quotes such characters, and offers -z precisely because of it.
describe('WorktreeStateSchema: what may become a cwd', () => {
  it('accepts the absolute path git actually reports', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/code/t1-wt1-x' })).not.toThrow();
  });

  it('accepts a path with spaces and unicode, which are legal', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/mã nguồn/t1 wt1' })).not.toThrow();
  });

  // A relative path is not a git worktree root -- it is a parse failure.
  it('REJECTS a relative path', () => {
    expect(() => createWorktreeState({ path: '../escape' })).toThrow();
    expect(() => createWorktreeState({ path: 'relative/thing' })).toThrow();
  });

  it('REJECTS an embedded newline, which would desynchronise the parse', () => {
    expect(() => createWorktreeState({ path: '/c/a\nworktree /c/b' })).toThrow();
  });

  it('REJECTS other control characters', () => {
    expect(() => createWorktreeState({ path: '/c/a\u0000b' })).toThrow();
    expect(() => createWorktreeState({ path: '/c/a\tb' })).toThrow();
  });

  it('REJECTS an empty path', () => {
    expect(() => createWorktreeState({ path: '' })).toThrow();
  });
});

// ---- strictObject: an unrecognised key is OUR typo, not a producer's field ----
// gatherOne assembles this literal itself from git output, so a key the schema
// does not know means the driver misspelled one. Under the default strip mode
// `stashcount: 3` would be discarded and stashCount would read 0 -- a clean
// worktree reported for a dirty one, from a single wrong letter. The MCP SDK
// records the same failure: "parameter name typos are silently dropped, leading
// to confusing behavior where tools execute with missing data".
//
// This is the OPPOSITE choice from AdminDriverRowSchema, which is looseObject on
// purpose because it parses a PRODUCER wire format where a newer server may add
// fields. Same library, different boundary, different mode -- the decision is
// who authored the object, not which library is in use.
describe('WorktreeStateSchema: strict about its own keys', () => {
  it('REJECTS a misspelled key instead of silently defaulting it', () => {
    expect(() => createWorktreeState({ stashcount: 3 } as never)).toThrow();
  });

  it('REJECTS an extra key the driver never meant to send', () => {
    expect(() => createWorktreeState({ upstream: 'origin/x' } as never)).toThrow();
  });

  it('still accepts exactly the declared shape', () => {
    expect(() => createWorktreeState({ dirtyFileCount: 2, locked: true })).not.toThrow();
  });

  // The failure must NAME the key, or the operator learns only that something
  // was wrong -- the diagnosability gap GitLab records for worktree cleanup.
  it('names the unrecognised key in the error', () => {
    let message = '';
    try {
      createWorktreeState({ stashcount: 1 } as never);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('stashcount');
  });
});

// ---- unreadable is a DISTINCT event, not an awkward verified one ----
// Both variants once carried event.name "fleet.estate.verified", so a consumer
// told them apart by inferring from `clean:false, checked:0`. That is the
// optional-properties bag discriminated-union guidance warns about: the invalid
// combination is representable, and "unclean with zero problems" reads exactly
// like "could not read". OTel says the same from the other side -- an event
// name identifies a payload STRUCTURE.
//
// An earlier test here asserted the OPPOSITE ("same shape, so one parser
// handles both"). It was deleted rather than repaired: it pinned the design
// being reversed.
describe('unreadableEstateEvent', () => {
  it('carries its own event name, so the discriminant is the name', () => {
    expect(unreadableEstateEvent('git-failed', AT)['event.name'])
      .toBe('fleet.estate.unreadable');
    expect(estateTelemetry(classifyEstate([]), null, DIGEST, AT)['event.name'])
      .toBe('fleet.estate.verified');
  });

  it('is always ERROR severity', () => {
    expect(unreadableEstateEvent('no-records', AT).severity_text).toBe('ERROR');
    expect(unreadableEstateEvent('no-records', AT).severity_number).toBe(17);
  });

  // The information the single shared payload used to lose.
  it('names WHICH failure occurred', () => {
    for (const r of UNREADABLE_REASONS) {
      expect(unreadableEstateEvent(r, AT).attributes.reason).toBe(r);
    }
  });

  it('cannot be mistaken for a clean estate', () => {
    const clean = estateTelemetry(classifyEstate([]), null, DIGEST, AT);
    const unreadable = unreadableEstateEvent('git-failed', AT);
    expect(clean.attributes.clean).toBe(true);
    expect('clean' in unreadable.attributes).toBe(false);
  });

  it('carries inherited trace context when present, omits it otherwise', () => {
    const withTrace = unreadableEstateEvent(
      'git-failed',
      AT,
      { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) },
    );
    expect(withTrace.trace_id).toBe('a'.repeat(32));
    expect('trace_id' in unreadableEstateEvent('git-failed', AT)).toBe(false);
  });

  it('carries the source digest when the porcelain was readable', () => {
    expect(unreadableEstateEvent('no-records', AT, null, digestOf('raw')).source_digest)
      .toBe(digestOf('raw'));
  });

  it('serialises to JSON without loss', () => {
    const t = unreadableEstateEvent('record-rejected', AT);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});


// ---- a rejected record must not crash the run ----
// The driver called WorktreeStateSchema.parse inside its gather loop, so a
// record git produced that the schema rejects threw an uncaught ZodError. The
// contract is EXACTLY ONE NDJSON event on stdout; an uncaught throw emits a
// stack trace and NO event, so the fail-closed guarantee vanished in precisely
// the case it exists for. 2026 practice: "throwing uncaught errors from
// validation is a sign of poor error handling" -- parse for trusted internal
// flows, safeParse for input a caller must handle without crashing.
describe('toWorktreeState', () => {
  it('returns the parsed state for a well-formed record', () => {
    const s = toWorktreeState({
      path: '/c/a', branch: 'x', dirtyFileCount: 0, aheadOfRemote: 0,
      stashCount: 0, prunable: false, locked: false,
    });
    expect(s?.path).toBe('/c/a');
  });

  it('returns NULL instead of throwing on a rejected record', () => {
    expect(() => toWorktreeState({ path: 'relative' })).not.toThrow();
    expect(toWorktreeState({ path: 'relative' })).toBeNull();
  });

  it('returns null for a record missing fields entirely', () => {
    expect(toWorktreeState({})).toBeNull();
    expect(toWorktreeState(null)).toBeNull();
    expect(toWorktreeState('worktree /c/a')).toBeNull();
  });

  // The strictObject rule still applies through this path.
  it('returns null for an unrecognised key rather than stripping it', () => {
    expect(toWorktreeState({
      path: '/c/a', branch: 'x', dirtyFileCount: 0, aheadOfRemote: 0,
      stashCount: 0, prunable: false, locked: false, stashcount: 9,
    })).toBeNull();
  });

  // A half-parsed worktree would be a guess, and guessing here means reporting
  // a verdict about a worktree we could not read.
  it('never returns a partial state', () => {
    const s = toWorktreeState({ path: '/c/a', branch: 'x' });
    expect(s).toBeNull();
  });
});

// ---- severity travels with the event; correlation is inherited ----
// SeverityText/SeverityNumber are part of the OTel Logs Data Model precisely so
// severity is not re-derived from payload fields by every consumer. And a
// trace_id this process invents for itself correlates NOTHING -- one run, one
// event -- so it is read from a parent's W3C traceparent or omitted, never
// fabricated. gate:agent already carries one per state transition for the same
// reason.
describe('severityFor', () => {
  it('a clean estate is INFO', () => {
    const s = severityFor(classifyEstate([CLEAN]));
    expect(s.severity_text).toBe('INFO');
    expect(s.severity_number).toBe(9);
  });

  it('an unclean estate is WARN, since a dirty worktree is a working state', () => {
    const s = severityFor(classifyEstate([createWorktreeState({ dirtyFileCount: 1 })]));
    expect(s.severity_text).toBe('WARN');
    expect(s.severity_number).toBe(13);
  });

  // Unreadable OUTRANKS unclean: a verdict we could not compute is a tooling
  // failure, not a housekeeping observation.
  it('an unreadable estate is ERROR, outranking unclean', () => {
    const s = severityFor(classifyEstate([]), false);
    expect(s.severity_text).toBe('ERROR');
    expect(s.severity_number).toBe(17);
  });

  it('rides on the emitted event, not only on the helper', () => {
    expect(estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT).severity_text).toBe('INFO');
    expect(unreadableEstateEvent('git-failed', AT).severity_text).toBe('ERROR');
  });
});

describe('traceContextFrom', () => {
  const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

  it('reads a well-formed W3C traceparent', () => {
    expect(traceContextFrom(VALID)).toEqual({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
    });
  });

  // Fabricating an id is worse than none: it looks like provenance and carries
  // none.
  it('returns null when no parent supplied one', () => {
    expect(traceContextFrom(undefined)).toBeNull();
    expect(traceContextFrom('')).toBeNull();
  });

  it('returns null for a malformed traceparent rather than guessing', () => {
    expect(traceContextFrom('not-a-traceparent')).toBeNull();
    expect(traceContextFrom('00-tooshort-00f067aa0ba902b7-01')).toBeNull();
    expect(traceContextFrom('99-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
  });

  // The W3C spec declares all-zero ids invalid.
  it('rejects all-zero ids, which the spec calls invalid', () => {
    expect(traceContextFrom('00-' + '0'.repeat(32) + '-00f067aa0ba902b7-01')).toBeNull();
    expect(traceContextFrom('00-4bf92f3577b34da6a3ce929d0e0e4736-' + '0'.repeat(16) + '-01')).toBeNull();
  });

  it('omits the fields entirely when there is no parent context', () => {
    const t = estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT);
    expect('trace_id' in t).toBe(false);
  });

  it('carries an inherited context onto the event', () => {
    const t = estateTelemetry(classifyEstate([CLEAN]), traceContextFrom(VALID), DIGEST, AT);
    expect(t.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(t.span_id).toBe('00f067aa0ba902b7');
  });
});

// ---- canonical form, not confinement ----
// Canonicalisation precedes validation: sanitising raw strings is how every
// traversal bypass works, and a path carrying .. or a trailing slash denotes
// the SAME worktree while comparing unequal. t96 fixed exactly this bug in
// worktree:close, where a literal compare against porcelain output refused a
// valid target.
//
// Confinement to an "estate root" is deliberately absent. Worktrees legitimately
// live OUTSIDE the repo -- this one is a sibling of the clone, not a descendant
// -- so a root check would reject every real path. git worktree list is itself
// the allowlist, and these paths are only ever a cwd for further execFileSync
// git calls: never opened, read, or written.
describe('WorktreeStateSchema: canonical paths only', () => {
  it('accepts an already-canonical absolute path', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/code/t1-wt1' })).not.toThrow();
  });

  it('REJECTS a path with a .. segment', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/code/../code/t1' })).toThrow();
  });

  it('REJECTS a trailing slash, which denotes the same worktree', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/code/t1/' })).toThrow();
  });

  it('REJECTS a doubled separator', () => {
    expect(() => createWorktreeState({ path: '/Users//dev/code/t1' })).toThrow();
  });

  it('REJECTS a single-dot segment', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/./code/t1' })).toThrow();
  });

  // A sibling of the clone is the NORMAL case, so no root confinement may
  // reject it.
  it('accepts a worktree outside the repository, the normal case', () => {
    expect(() => createWorktreeState({ path: '/Users/dev/code/t116-wt1-estate-verify' }))
      .not.toThrow();
  });
});

// ---- content address of the snapshot ----
// Lets a consumer say "this is the state I acted on" and re-derive it, and tells
// an unchanged estate from one that changed and changed back -- which a
// timestamp cannot. Determinism IS the value, so these pin it.
//
// NOT signed, deliberately: a local tool signing with a key it holds proves
// nothing, since signer and verifier are the same principal. 2026 guidance is
// that the signing identity "should not be accessible to the build script", and
// keyless signing needs an ambient OIDC identity that exists in CI, not on a
// laptop.
describe('estateDigest', () => {
  const A = createWorktreeState({ path: '/c/a', branch: 'x' });
  const B = createWorktreeState({ path: '/c/b', branch: 'y', dirtyFileCount: 2 });

  it('is stable across repeated calls on the same snapshot', () => {
    expect(estateDigest([A, B])).toBe(estateDigest([A, B]));
  });

  // Order comes from git's walk, which is not a property of the estate.
  it('is independent of the order the worktrees were listed in', () => {
    expect(estateDigest([A, B])).toBe(estateDigest([B, A]));
  });

  it('changes when any field changes', () => {
    const before = estateDigest([A]);
    expect(estateDigest([createWorktreeState({ path: '/c/a', branch: 'x', stashCount: 1 })]))
      .not.toBe(before);
  });

  it('changes when a worktree is added or removed', () => {
    expect(estateDigest([A])).not.toBe(estateDigest([A, B]));
  });

  // Changed-and-changed-back must be indistinguishable from never-changed:
  // that is what makes it a content address rather than a version counter.
  it('returns to the SAME digest when the estate returns to the same state', () => {
    const original = estateDigest([A, B]);
    const changed = estateDigest([A]);
    expect(changed).not.toBe(original);
    expect(estateDigest([A, B])).toBe(original);
  });

  it('is a sha256 hex string', () => {
    expect(estateDigest([A])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an empty estate still has a stable digest', () => {
    expect(estateDigest([])).toBe(estateDigest([]));
    expect(estateDigest([])).not.toBe(estateDigest([A]));
  });

  it('rides on the emitted event when supplied', () => {
    const t = estateTelemetry(classifyEstate([A]), null, estateDigest([A]), AT);
    expect(t.estate_digest).toBe(estateDigest([A]));
  });

  it('is omitted when there was no snapshot to address', () => {
    expect('estate_digest' in unreadableEstateEvent('no-records', AT)).toBe(false);
  });
});

// ---- source digest: an estate that changed vs code that changed ----
// estate_digest addresses the PARSED snapshot, so on its own it cannot say
// whether a difference came from the worktrees moving or from the parser
// changing underneath. source_digest addresses the RAW porcelain, and the pair
// separates those: same source, different estate == the CODE moved.
//
// The ADDRESS is retained, not the bytes. Porcelain is unbounded across a large
// estate, and audit guidance is explicit that logging too much overwhelms the
// store while adding no evidentiary value. Immutability itself is a property of
// the STORE -- object lock, append-only backends -- not of a local process that
// could delete anything it wrote; a tool claiming it of its own output would be
// asserting what it cannot enforce.
describe('digestOf and source_digest', () => {
  it('is stable for the same text', () => {
    expect(digestOf('worktree /c/a')).toBe(digestOf('worktree /c/a'));
  });

  it('changes for different text', () => {
    expect(digestOf('worktree /c/a')).not.toBe(digestOf('worktree /c/b'));
  });

  it('is the same function the snapshot digest uses', () => {
    const only = createWorktreeState({ path: '/c/a', branch: 'x' });
    expect(estateDigest([only])).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOf('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rides on the event when supplied', () => {
    const t = estateTelemetry(classifyEstate([]), null, DIGEST, AT, digestOf('raw'));
    expect(t.source_digest).toBe(digestOf('raw'));
  });

  it('is omitted when not supplied, never fabricated', () => {
    expect('source_digest' in estateTelemetry(classifyEstate([]), null, DIGEST, AT)).toBe(false);
  });

  // The discrimination the pair exists for.
  it('same source with a different snapshot means the CODE moved', () => {
    const raw = 'worktree /c/a';
    const before = estateTelemetry(
      classifyEstate([createWorktreeState({ path: '/c/a' })]),
      null, estateDigest([createWorktreeState({ path: '/c/a' })]), AT, digestOf(raw),
    );
    const after = estateTelemetry(
      classifyEstate([createWorktreeState({ path: '/c/a', dirtyFileCount: 1 })]),
      null,
      estateDigest([createWorktreeState({ path: '/c/a', dirtyFileCount: 1 })]),
      AT, digestOf(raw),
    );
    expect(after.source_digest).toBe(before.source_digest);
    expect(after.estate_digest).not.toBe(before.estate_digest);
  });
});

// ---- two kinds, two remediation policies ----
// dirty/unpushed/stash are WORK IN PROGRESS: the operator has work in flight
// and the fix is to finish it. prunable/locked are STRUCTURAL: the worktree
// itself is defective or deliberately held, and the fix is a git repair
// command. A router previously had to hardcode the reason list to tell them
// apart, which is how a consumer ends up re-implementing the vocabulary.
describe('REASON_KIND and kindsFor', () => {
  it('classifies work-in-progress reasons', () => {
    expect(REASON_KIND.dirty).toBe('work-in-progress');
    expect(REASON_KIND.unpushed).toBe('work-in-progress');
    expect(REASON_KIND.stash).toBe('work-in-progress');
  });

  it('classifies structural reasons', () => {
    expect(REASON_KIND.prunable).toBe('structural');
    expect(REASON_KIND.locked).toBe('structural');
  });

  // Totality: the Record is typed over EstateReason, so a new reason left
  // unclassified is a COMPILE error. This asserts the runtime half.
  it('classifies every reason, with none left over', () => {
    expect(Object.keys(REASON_KIND).sort()).toEqual([...ESTATE_REASONS].sort());
  });

  it('collapses five reasons into at most two kinds', () => {
    expect(kindsFor([...ESTATE_REASONS])).toEqual(['work-in-progress', 'structural']);
  });

  it('reports only the kinds actually present', () => {
    expect(kindsFor(['dirty', 'stash'])).toEqual(['work-in-progress']);
    expect(kindsFor(['prunable'])).toEqual(['structural']);
  });

  it('is empty for a clean estate', () => {
    expect(kindsFor([])).toEqual([]);
  });

  // The discrimination the whole taxonomy exists for.
  it('separates a merely dirty worktree from a broken one on the event', () => {
    const wip = estateTelemetry(classifyEstate([
      createWorktreeState({ path: '/c/a', dirtyFileCount: 3 }),
    ]), null, DIGEST, AT);
    const broken = estateTelemetry(classifyEstate([
      createWorktreeState({ path: '/c/b', prunable: true }),
    ]), null, DIGEST, AT);
    expect(wip.attributes.kinds).toEqual(['work-in-progress']);
    expect(broken.attributes.kinds).toEqual(['structural']);
  });

  it('reports both kinds when the estate has both', () => {
    const t = estateTelemetry(classifyEstate([
      createWorktreeState({ path: '/c/a', dirtyFileCount: 1 }),
      createWorktreeState({ path: '/c/b', locked: true }),
    ]), null, DIGEST, AT);
    expect(t.attributes.kinds).toEqual(['work-in-progress', 'structural']);
  });
});

// ---- the driver's decisions, now reachable ----
// These three fail-closed paths were decided inline in mainEstateVerify, which
// lives under a v8-ignore because it spawns git -- so "git threw, so emit
// git-failed and exit 3" was verified by reading the code and nothing else.
// Moving the instantiation up a level and testing the INTERACTION is the 2026
// answer for subprocess-bearing CLIs, and the split decideClose and
// decideMergeReady already use here.
describe('decideEstate', () => {
  const DIGEST = digestOf('worktree /c/a');

  it('git-failed emits the unreadable event and exits 3', () => {
    const d = decideEstate({ kind: 'git-failed' });
    expect(d.exitCode).toBe(3);
    expect(d.event['event.name']).toBe('fleet.estate.unreadable');
    expect(d.kind).toBe('unreadable');
  });

  // The confident zero: git exited 0 and produced nothing parseable.
  it('no-records exits 3, never 0', () => {
    const d = decideEstate({ kind: 'no-records', sourceDigest: DIGEST });
    expect(d.exitCode).toBe(3);
    expect(d.kind).toBe('unreadable');
  });

  it('record-rejected exits 3 rather than reporting over the survivors', () => {
    const d = decideEstate({ kind: 'record-rejected', sourceDigest: DIGEST });
    expect(d.exitCode).toBe(3);
    expect(d.kind).toBe('unreadable');
  });

  // Each unreadable path names ITSELF, which the single shared payload could not.
  it('each unreadable path carries its own reason', () => {
    expect(decideEstate({ kind: 'git-failed' }).event.attributes)
      .toEqual({ reason: 'git-failed' });
    expect(decideEstate({ kind: 'no-records', sourceDigest: DIGEST }).event.attributes)
      .toEqual({ reason: 'no-records' });
    expect(decideEstate({ kind: 'record-rejected', sourceDigest: DIGEST }).event.attributes)
      .toEqual({ reason: 'record-rejected' });
  });

  it('a clean estate exits 0 and carries a verdict', () => {
    const d = decideEstate({ kind: 'states', states: [CLEAN], sourceDigest: DIGEST });
    expect(d.exitCode).toBe(0);
    expect(d.event['event.name']).toBe('fleet.estate.verified');
    if (d.kind !== 'verified') throw new Error('expected verified');
    expect(d.verdict.clean).toBe(true);
  });

  it('an unclean estate exits 1, distinct from unreadable', () => {
    const d = decideEstate({
      kind: 'states',
      states: [createWorktreeState({ path: '/c/a', dirtyFileCount: 1 })],
      sourceDigest: DIGEST,
    });
    expect(d.exitCode).toBe(1);
    if (d.kind !== 'verified') throw new Error('expected verified');
    expect(d.verdict.clean).toBe(false);
  });

  // git-failed has no porcelain to address, so it cannot carry a source digest.
  it('carries the source digest only when the porcelain was readable', () => {
    const gf = decideEstate({ kind: 'git-failed' }).event;
    if (gf['event.name'] !== 'fleet.estate.unreadable') throw new Error('expected unreadable');
    expect(gf.source_digest).toBeUndefined();
    const nr = decideEstate({ kind: 'no-records', sourceDigest: DIGEST }).event;
    if (nr['event.name'] !== 'fleet.estate.unreadable') throw new Error('expected unreadable');
    expect(nr.source_digest)
      .toBe(DIGEST);
  });

  it('passes inherited trace context through to the event', () => {
    const trace = { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) };
    expect(decideEstate({ kind: 'git-failed' }, trace).event.trace_id).toBe('a'.repeat(32));
    expect(
      decideEstate({ kind: 'states', states: [CLEAN], sourceDigest: DIGEST }, trace)
        .event.trace_id,
    ).toBe('a'.repeat(32));
  });

  // A verdict is present ONLY when one was computed, so a caller cannot render
  // prose about an estate that was never read.
  it('never returns a verdict on an unreadable path', () => {
    for (const g of [
      { kind: 'git-failed' } as const,
      { kind: 'no-records', sourceDigest: DIGEST } as const,
      { kind: 'record-rejected', sourceDigest: DIGEST } as const,
    ]) {
      expect(decideEstate(g).kind).toBe('unreadable');
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
    const d = decideEstate(
      { kind: 'states', states: STATES, sourceDigest: SRC }, null, CURRENT,
    );
    expect(d.exitCode).toBe(0);
    expect(d.event['event.name']).toBe('fleet.estate.verified');
  });

  it('REFUSES with exit 4 when the estate moved underneath', () => {
    const d = decideEstate(
      { kind: 'states', states: STATES, sourceDigest: SRC }, null, digestOf('stale'),
    );
    expect(d.exitCode).toBe(4);
    expect(d.event['event.name']).toBe('fleet.estate.stale');
    expect(d.kind).toBe('stale');
  });

  // Both digests, so the caller can diff its plan against reality rather than
  // re-deriving what it thought it knew.
  it('names both the expected and the actual digest', () => {
    const stale = digestOf('stale');
    const d = decideEstate(
      { kind: 'states', states: STATES, sourceDigest: SRC }, null, stale,
    );
    if (d.event['event.name'] !== 'fleet.estate.stale') throw new Error('expected stale');
    expect(d.event.attributes.expected_digest).toBe(stale);
    expect(d.event.attributes.estate_digest).toBe(CURRENT);
  });

  // Omitted means "I did not plan against anything", which must behave exactly
  // as before -- an opt-in precondition, like If-Match.
  it('is opt-in: omitting it changes nothing', () => {
    const withOut = decideEstate({ kind: 'states', states: STATES, sourceDigest: SRC });
    const withNull = decideEstate(
      { kind: 'states', states: STATES, sourceDigest: SRC }, null, null,
    );
    expect(withOut.exitCode).toBe(0);
    expect(withNull.exitCode).toBe(0);
  });

  // The check runs BEFORE the verdict, so a dirty estate that also moved
  // reports the staleness -- re-reading is the fix, not cleaning worktrees.
  it('staleness outranks uncleanliness, because re-reading comes first', () => {
    const dirty = [createWorktreeState({ path: '/c/a', dirtyFileCount: 3 })];
    const d = decideEstate(
      { kind: 'states', states: dirty, sourceDigest: SRC }, null, digestOf('stale'),
    );
    expect(d.exitCode).toBe(4);
  });

  // An unreadable estate cannot be compared at all: there is no digest to
  // match, so the precondition must not mask the more serious failure.
  it('never masks an unreadable estate', () => {
    const d = decideEstate({ kind: 'git-failed' }, null, digestOf('anything'));
    expect(d.exitCode).toBe(3);
    expect(d.event['event.name']).toBe('fleet.estate.unreadable');
  });

  it('exit 4 is distinct from every other outcome', () => {
    const codes = new Set([
      decideEstate({ kind: 'states', states: STATES, sourceDigest: SRC }).exitCode,
      decideEstate({ kind: 'states', states: [createWorktreeState({ dirtyFileCount: 1 })], sourceDigest: SRC }).exitCode,
      decideEstate({ kind: 'git-failed' }).exitCode,
      decideEstate({ kind: 'states', states: STATES, sourceDigest: SRC }, null, digestOf('x')).exitCode,
    ]);
    expect(codes).toEqual(new Set([0, 1, 3, 4]));
  });
});

// ---- every event carries its schema version ----
// event.name says WHICH event; schema_version says which REVISION of that
// payload, which a name cannot express. Without it a consumer cannot tell a
// field it does not recognise from one that was removed, and 2026 guidance
// lists "publishing different shapes of the same event without a version"
// among the practices to avoid outright.
//
// Not hypothetical: this arc already made a breaking change, moving the
// unreadable case off fleet.estate.verified onto its own name and shape. A
// consumer written against the earlier form would have broken with no signal.
describe('ESTATE_SCHEMA_VERSION', () => {
  it('is semver, so a consumer can reason about the KIND of change', () => {
    expect(ESTATE_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The whole point of one constant: a bump cannot land on some events and
  // miss others.
  it('rides on EVERY variant, not just the common one', () => {
    const verified = estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT);
    const unreadable = unreadableEstateEvent('git-failed', AT);
    const stale = estateStaleEvent(digestOf('a'), digestOf('b'), AT);
    expect(verified.schema_version).toBe(ESTATE_SCHEMA_VERSION);
    expect(unreadable.schema_version).toBe(ESTATE_SCHEMA_VERSION);
    expect(stale.schema_version).toBe(ESTATE_SCHEMA_VERSION);
  });

  it('is identical across variants, since they share one contract revision', () => {
    const versions = new Set([
      estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT).schema_version,
      unreadableEstateEvent('no-records', AT).schema_version,
      estateStaleEvent(digestOf('a'), digestOf('b'), AT).schema_version,
    ]);
    expect(versions.size).toBe(1);
  });

  it('survives serialisation, so a subscriber reads it off the wire', () => {
    const t = JSON.parse(JSON.stringify(estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT)));
    expect(t.schema_version).toBe(ESTATE_SCHEMA_VERSION);
  });

  // Version and name are INDEPENDENT axes: the name identifies the event, the
  // version identifies its revision. Conflating them is how a rename gets
  // mistaken for a compatible change.
  it('is carried alongside event.name, not encoded into it', () => {
    const t = estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT);
    expect(t['event.name']).toBe('fleet.estate.verified');
    expect(t['event.name'].includes(ESTATE_SCHEMA_VERSION)).toBe(false);
  });
});

// ---- the emitted contract is executable, not just declared ----
// The events are the published contract: they carry schema_version and an agent
// parses them. They were hand-written interfaces with no runtime artifact, so
// nothing executable connected what we DECLARE to what we EMIT -- and adding
// schema_version last round did not, by itself, force a bump when the shape
// changed. 2026 guidance calls for exactly this contract assertion: make the
// relationship executable so a schema and its validator cannot drift silently,
// failing the build rather than a live run.
describe('EstateEventSchema: what we emit parses against what we declare', () => {
  const STATES = [createWorktreeState({ path: '/c/a', branch: 'x' })];
  const TRACE = { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) };

  it('accepts a clean verdict event', () => {
    const r = EstateEventSchema.safeParse(estateTelemetry(classifyEstate(STATES), null, DIGEST, AT));
    expect(r.success).toBe(true);
  });

  it('accepts an unclean verdict event, digests and all', () => {
    const v = classifyEstate([createWorktreeState({ path: '/c/a', dirtyFileCount: 2 })]);
    const e = estateTelemetry(v, TRACE, estateDigest(STATES), AT, digestOf('raw'));
    expect(EstateEventSchema.safeParse(e).success).toBe(true);
  });

  it('accepts every unreadable reason', () => {
    for (const reason of UNREADABLE_REASONS) {
      expect(EstateEventSchema.safeParse(unreadableEstateEvent(reason, AT)).success).toBe(true);
    }
  });

  it('accepts a stale event', () => {
    const e = estateStaleEvent(digestOf('a'), digestOf('b'), AT, TRACE);
    expect(EstateEventSchema.safeParse(e).success).toBe(true);
  });

  // Every event the DECIDER can produce, not just the ones constructed by hand.
  it('accepts every decision the decider can reach', () => {
    const SRC = digestOf('raw');
    const decisions = [
      decideEstate({ kind: 'git-failed' }),
      decideEstate({ kind: 'no-records', sourceDigest: SRC }),
      decideEstate({ kind: 'record-rejected', sourceDigest: SRC }),
      decideEstate({ kind: 'states', states: STATES, sourceDigest: SRC }),
      decideEstate({ kind: 'states', states: STATES, sourceDigest: SRC }, null, digestOf('x')),
    ];
    for (const d of decisions) {
      expect(EstateEventSchema.safeParse(d.event).success).toBe(true);
    }
  });

  // strictObject: an unrecognised key is a producer typo, and the contract must
  // catch it rather than let a consumer discover it.
  it('REJECTS an event carrying a key the contract does not declare', () => {
    const e = { ...estateTelemetry(classifyEstate(STATES), null, DIGEST, AT), surprise: 1 };
    expect(EstateEventSchema.safeParse(e).success).toBe(false);
  });

  // The bump enforcer: schema_version is a literal in the schema, so an event
  // stamped with any other version fails to parse. A consumer pinned to 1.0.0
  // cannot be handed a 2.0.0 payload by accident.
  it('REJECTS an event stamped with a different schema version', () => {
    const e = { ...estateTelemetry(classifyEstate(STATES), null, DIGEST, AT), schema_version: '2.0.0' };
    expect(EstateEventSchema.safeParse(e).success).toBe(false);
  });

  it('REJECTS an unknown event name rather than accepting it loosely', () => {
    const e = { ...estateTelemetry(classifyEstate(STATES), null, DIGEST, AT), 'event.name': 'fleet.estate.other' };
    expect(EstateEventSchema.safeParse(e).success).toBe(false);
  });

  // Round-trip: what a consumer reads off stdout is what the schema accepts,
  // so JSON serialisation cannot introduce a shape the contract rejects.
  it('accepts the SERIALISED form, which is what a consumer actually reads', () => {
    for (const e of [
      estateTelemetry(classifyEstate(STATES), TRACE, estateDigest(STATES), AT, digestOf('r')),
      unreadableEstateEvent('no-records', AT, TRACE, digestOf('r')),
      estateStaleEvent(digestOf('a'), digestOf('b'), AT, TRACE),
    ]) {
      expect(EstateEventSchema.safeParse(JSON.parse(JSON.stringify(e))).success).toBe(true);
    }
  });
});

// ---- one declaration per vocabulary ----
// The event schema hand-listed kinds and severity levels rather than deriving
// them, so ReasonKind or EstateSeverity could gain a value the VALIDATOR never
// learned about -- the same class of typo/drift hole one level up from the
// reason codes, which were already derived from ESTATE_REASONS.
//
// The as-const array is the technique that makes one declaration serve the
// type, the ordering and the runtime schema at once.
describe('vocabularies are declared once', () => {
  it('every kind the type admits is accepted by the schema', () => {
    for (const k of REASON_KINDS) {
      const e = estateTelemetry(classifyEstate([
        createWorktreeState({ path: '/c/a', ...(k === 'structural' ? { locked: true } : { dirtyFileCount: 1 }) }),
      ]), null, DIGEST, AT);
      expect(e.attributes.kinds).toContain(k);
      expect(EstateEventSchema.safeParse(e).success).toBe(true);
    }
  });

  it('every severity the type admits is accepted by the schema', () => {
    expect(SEVERITY_TEXTS).toEqual(['INFO', 'WARN', 'ERROR']);
    expect(SEVERITY_NUMBERS).toEqual([9, 13, 17]);
    for (const t of SEVERITY_TEXTS) {
      expect(['INFO', 'WARN', 'ERROR']).toContain(t);
    }
  });

  // The schema must reject a kind the vocabulary does not contain, or deriving
  // it bought nothing.
  it('REJECTS a kind outside the vocabulary', () => {
    const e = estateTelemetry(classifyEstate([createWorktreeState({ dirtyFileCount: 1 })]), null, DIGEST, AT);
    const tampered = { ...e, attributes: { ...e.attributes, kinds: ['invented'] } };
    expect(EstateEventSchema.safeParse(tampered).success).toBe(false);
  });

  it('REJECTS a reason outside the vocabulary', () => {
    const e = estateTelemetry(classifyEstate([createWorktreeState({ dirtyFileCount: 1 })]), null, DIGEST, AT);
    const tampered = { ...e, attributes: { ...e.attributes, reasons: ['dirtyy'] } };
    expect(EstateEventSchema.safeParse(tampered).success).toBe(false);
  });

  it('REJECTS a severity outside the vocabulary', () => {
    const e = estateTelemetry(classifyEstate([CLEAN]), null, DIGEST, AT);
    expect(EstateEventSchema.safeParse({ ...e, severity_text: 'TRACE' }).success).toBe(false);
    expect(EstateEventSchema.safeParse({ ...e, severity_number: 5 }).success).toBe(false);
  });

  // The critique's specific case: `reasons` is an OUTPUT of classification and
  // must never appear on an input state. strictObject already forbids it, which
  // is stronger than a compile-only `reasons?: never`.
  it('a worktree state carrying `reasons` is REJECTED, not stripped', () => {
    expect(() => createWorktreeState({ reasons: ['dirty'] } as never)).toThrow();
  });
});

// ---- a span of our own, inside the caller's trace ----
// Every event copied the PARENT's span_id verbatim, so this task's events
// claimed to belong to the parent's span and estate:verify never appeared as an
// operation of its own -- a trace with a hole exactly where the work happened.
// W3C is explicit that a child generates a NEW span id and records the received
// one as its parent.
describe('spanContextFor', () => {
  const PARENT = { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) };
  const FIXED = (): string => 'c'.repeat(16);

  it('keeps the caller trace_id, so both belong to ONE trace', () => {
    expect(spanContextFor(PARENT, FIXED)?.trace_id).toBe(PARENT.trace_id);
  });

  // The defect: this used to be the parent's span id.
  it('generates a NEW span_id rather than reusing the parent', () => {
    expect(spanContextFor(PARENT, FIXED)?.span_id).not.toBe(PARENT.span_id);
  });

  it('records the parent so a collector can nest the span', () => {
    expect(spanContextFor(PARENT, FIXED)?.parent_span_id).toBe(PARENT.span_id);
  });

  // No parent means no trace to join; inventing one correlates nothing.
  it('stays null when no parent supplied a traceparent', () => {
    expect(spanContextFor(null, FIXED)).toBeNull();
  });

  it('rides onto the emitted event', () => {
    const e = estateTelemetry(classifyEstate([CLEAN]), spanContextFor(PARENT, FIXED), DIGEST, AT);
    expect(e.trace_id).toBe(PARENT.trace_id);
    expect(e.span_id).toBe('c'.repeat(16));
    expect(e.parent_span_id).toBe(PARENT.span_id);
    expect(EstateEventSchema.safeParse(e).success).toBe(true);
  });
});

describe('newSpanId', () => {
  it('is 16 lowercase hex characters, per W3C', () => {
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  // Concurrency is real here: two laptops sweep the same estate at once.
  it('does not repeat across many draws', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSpanId()));
    expect(ids.size).toBe(500);
  });

  // The W3C spec calls an all-zero span id invalid, so it must never be emitted.
  it('never returns the all-zero id the spec forbids', () => {
    expect(newSpanId(() => Buffer.alloc(8))).not.toBe('0'.repeat(16));
    expect(newSpanId(() => Buffer.alloc(8))).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---- determinism and order-independence, for CLEAN estates too ----
// Only the problem paths were order-checked. That left the classifier's two
// most basic invariants unasserted -- idempotence and commutativity, which the
// property-testing literature calls "free invariants" precisely because a pure
// function should have them for nothing.
//
// It also hid a real inconsistency: estateDigest SORTS by path, so the digest
// was order-independent, while classifyEstate pushed problems in git's listing
// order. An unchanged estate could therefore produce the same estate_digest
// with a differently-ordered body.problems, and a consumer diffing two events
// would see a change that never happened. classifyEstate now sorts, and these
// pin it.
//
// Exhaustive permutation rather than random generation: the input space that
// matters here is a handful of worktrees, so every ordering is cheaper AND
// stronger than sampling it.
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += 1) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    const head = xs[i];
    if (head === undefined) continue;
    for (const p of permutations(rest)) out.push([head, ...p]);
  }
  return out;
}

describe('classifyEstate: free invariants', () => {
  const CLEAN_A = createWorktreeState({ path: '/c/a', branch: 'x' });
  const CLEAN_B = createWorktreeState({ path: '/c/b', branch: 'y' });
  const CLEAN_C = createWorktreeState({ path: '/c/c', branch: 'z' });
  const DIRTY_A = createWorktreeState({ path: '/c/a', dirtyFileCount: 1 });
  const DIRTY_B = createWorktreeState({ path: '/c/b', stashCount: 2 });
  const STRUCT_C = createWorktreeState({ path: '/c/c', prunable: true });

  // IDEMPOTENCE: the same input classified twice is the same verdict. A pure
  // function has this for free -- unless it mutates its input or reads a clock.
  it('is deterministic across repeated calls on a CLEAN estate', () => {
    const states = [CLEAN_A, CLEAN_B, CLEAN_C];
    expect(classifyEstate(states)).toEqual(classifyEstate(states));
  });

  it('is deterministic across repeated calls on an unclean estate', () => {
    const states = [DIRTY_A, CLEAN_B, STRUCT_C];
    expect(classifyEstate(states)).toEqual(classifyEstate(states));
  });

  // COMMUTATIVITY over EVERY ordering, clean estates included -- the case the
  // existing tests skipped entirely.
  it('gives the identical verdict for every ordering of a CLEAN estate', () => {
    const orderings = permutations([CLEAN_A, CLEAN_B, CLEAN_C]);
    expect(orderings).toHaveLength(6);
    const first = classifyEstate(orderings[0] ?? []);
    for (const o of orderings) {
      expect(classifyEstate(o)).toEqual(first);
    }
  });

  it('gives the identical verdict for every ordering of an unclean estate', () => {
    const orderings = permutations([DIRTY_A, DIRTY_B, STRUCT_C]);
    const first = classifyEstate(orderings[0] ?? []);
    for (const o of orderings) {
      expect(classifyEstate(o)).toEqual(first);
    }
  });

  it('gives the identical verdict for every MIXED ordering', () => {
    const orderings = permutations([DIRTY_A, CLEAN_B, STRUCT_C]);
    const first = classifyEstate(orderings[0] ?? []);
    for (const o of orderings) {
      expect(classifyEstate(o)).toEqual(first);
    }
  });

  // The inconsistency this found: the digest sorted, the verdict did not.
  it('orders problems the SAME way estateDigest orders its input', () => {
    for (const o of permutations([DIRTY_B, STRUCT_C, DIRTY_A])) {
      const v = classifyEstate(o);
      expect(v.problems.map((p) => p.path)).toEqual(['/c/a', '/c/b', '/c/c']);
    }
  });

  // The consequence a consumer actually sees: same estate, same event, whatever
  // order git happened to list the worktrees in.
  it('emits a byte-identical event for every ordering', () => {
    const orderings = permutations([DIRTY_A, DIRTY_B, STRUCT_C]);
    const events = orderings.map((o) =>
      JSON.stringify(estateTelemetry(classifyEstate(o), null, estateDigest(o), AT)),
    );
    expect(new Set(events).size).toBe(1);
  });

  // A pure function must not consume its argument.
  it('does not mutate the array it was given', () => {
    const states = [DIRTY_B, CLEAN_A, STRUCT_C];
    const before = states.map((s) => s.path);
    classifyEstate(states);
    expect(states.map((s) => s.path)).toEqual(before);
  });

  // Identity-ish: adding a CLEAN worktree changes the count and nothing else.
  it('adding a clean worktree leaves the problem set untouched', () => {
    const withOut = classifyEstate([DIRTY_A]);
    const withClean = classifyEstate([DIRTY_A, CLEAN_B]);
    expect(withClean.problems).toEqual(withOut.problems);
    expect(withClean.checked).toBe(withOut.checked + 1);
    expect(withClean.clean).toBe(false);
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
// back through --expect-digest. Optional evidence was a type admitting an
// action nobody downstream could check.
describe('the recommendation is bound to its evidence', () => {
  const STATES = [createWorktreeState({ path: '/c/a', dirtyFileCount: 1 })];
  const SNAPSHOT = estateDigest(STATES);

  it('a verdict always names the snapshot it was computed from', () => {
    const e = estateTelemetry(classifyEstate(STATES), null, SNAPSHOT, AT);
    expect(e.estate_digest).toBe(SNAPSHOT);
  });

  // The binding, stated as the property that makes it useful: the digest on the
  // event is exactly what a caller hands back to re-verify.
  it('the emitted digest is the one --expect-digest accepts', () => {
    const decided = decideEstate({
      kind: 'states', states: STATES, sourceDigest: digestOf('raw'),
    });
    if (decided.kind !== 'verified') throw new Error('expected verified');
    const replayed = decideEstate(
      { kind: 'states', states: STATES, sourceDigest: digestOf('raw') },
      null,
      decided.event.estate_digest,
    );
    expect(replayed.kind).toBe('verified');
  });

  // And the same binding REFUSES once the estate has moved, which is what makes
  // the recommendation checkable rather than merely advisory-in-name.
  it('a recommendation cannot be replayed against a moved estate', () => {
    const decided = decideEstate({
      kind: 'states', states: STATES, sourceDigest: digestOf('raw'),
    });
    if (decided.kind !== 'verified') throw new Error('expected verified');
    const moved = [createWorktreeState({ path: '/c/a', dirtyFileCount: 99 })];
    const replayed = decideEstate(
      { kind: 'states', states: moved, sourceDigest: digestOf('raw') },
      null,
      decided.event.estate_digest,
    );
    expect(replayed.kind).toBe('stale');
    expect(replayed.event.agent_action).toBe('REREAD_ESTATE');
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
// The root fix is nominal typing, which this file already uses for
// WorktreeState: a z.infer of an UNBRANDED string is just string, so the type
// bought nothing. Branded, the compiler refuses an unparsed string outright --
// "impossible to call this function with an unvalidated string" -- at zero
// runtime cost, since the brand is erased.
//
// The directives below ARE the assertion: each fails the BUILD if its line
// ever starts compiling, which is precisely the regression worth pinning.
describe('a digest cannot be conjured from a string', () => {
  const STATES = [createWorktreeState({ path: '/c/a', branch: 'x' })];
  const GATHERED = {
    kind: 'states', states: STATES, sourceDigest: digestOf('raw'),
  } as const;

  it('REFUSES a raw string as --expect-digest, at compile time', () => {
    // @ts-expect-error a plain string is not a parsed Digest
    decideEstate(GATHERED, null, 'a'.repeat(64));
    expect(true).toBe(true);
  });

  it('REFUSES an uppercase digest, the case that looked valid', () => {
    // @ts-expect-error uppercase hex never matches our lowercase output
    decideEstate(GATHERED, null, 'A1B2'.repeat(16));
    expect(true).toBe(true);
  });

  it('ACCEPTS one that came through the schema', () => {
    const d = decideEstate(GATHERED, null, DigestSchema.parse('a'.repeat(64)));
    expect(d.kind).toBe('stale');
  });

  it('ACCEPTS one produced by our own hashing', () => {
    const d = decideEstate(GATHERED, null, estateDigest(STATES));
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

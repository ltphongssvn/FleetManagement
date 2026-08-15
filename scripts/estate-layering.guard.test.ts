// scripts/estate-layering.guard.test.ts
// ARCHITECTURAL GUARD: the estate arc's modules form a DAG, and its two leaves
// are the vocabulary and the event primitives.
//
// WHY. estate-verify.ts imported estate-action.ts for the action schema while
// estate-action.ts imported estate-verify.ts back for REASON_KIND. A second
// cycle ran through estate-reasons-across.ts. Both typechecked, both linted,
// and both passed 1249 tests -- which is precisely the hazard. ESM resolves the
// import graph statically and evaluates children before parents, so a
// module-scope binding read across a cycle throws only when the load order puts
// the reader first.
//
// The read was real: EventBaseShape is a top-level const in estate-verify.ts
// that reads EstateActionSchema out of the cycle. 2026 guidance names the
// failure mode exactly -- it "appears or disappears based on load order, which
// changes when any import is added anywhere in the graph", and the diagnostic
// is that adding a console.log moves it. Nothing in a normal gate can see that.
//
// The documented fix is a third module both sides import from, and the
// documented ENFORCEMENT is a cycle check in CI. This is that check, written as
// a test rather than a new dependency: the graph is a handful of files, so
// walking it here is cheaper and more precise than adding madge to the
// toolchain.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACTION_EXIT, ESTATE_ACTIONS } from './estate-action.js';
import { ESTATE_REASONS, REASON_KIND, REASON_KINDS } from './estate-vocabulary.js';
import {
  SEVERITY_NUMBERS,
  SEVERITY_TEXTS,
  UNREADABLE_REASONS,
} from './estate-verify.js';
import { UNOBSERVABLE_REASONS } from './estate-gather.js';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** The modules of this arc. The two LEAVES are listed first because everything
 *  else may depend on them and they may depend on nothing. */
const ARC = [
  'estate-vocabulary',
  'estate-events',
  'estate-action',
  'estate-verify',
  'estate-verify-cli',
  'estate-attestation',
  'estate-run',
  'estate-streams',
  'estate-gather',
] as const;

/** Local module specifiers imported by a file, as bare names. Matches the
 *  './name.js' form this arc uses; a bare package like zod is deliberately not
 *  matched, since only local edges can form a cycle within the arc. */
function localImports(module: string): readonly string[] {
  const source = readFileSync(join(ROOT, 'scripts', module + '.ts'), 'utf-8');
  const found = source.match(/from '\.\/[a-z0-9-]+\.js'/g) ?? [];
  return found.map((m) => m.slice("from './".length, -".js'".length));
}

/** Every module reachable from a start point, following local edges. */
function reachableFrom(start: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [...localImports(start)];
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    queue.push(...localImports(next));
  }
  return seen;
}

describe('the estate arc is a DAG', () => {
  // THE DEFECT THIS CLOSES. Stated as reachability rather than as a list of
  // known pairs, so a cycle introduced through a NEW module is caught too.
  it('has no module in the estate arc importing itself, however indirectly', () => {
    for (const module of ARC) {
      expect([module, [...reachableFrom(module)]]).toEqual([module, expect.not.arrayContaining([module])]);
    }
  });

  it('names every module of the arc, so a new one cannot escape the check', () => {
    for (const module of ARC) {
      expect(() => localImports(module)).not.toThrow();
    }
  });
});

describe('the vocabulary is the leaf', () => {
  // A leaf cannot participate in a cycle, which is what makes it safe as the
  // neutral ground both sides import from.
  it('imports no local module at all', () => {
    expect(localImports('estate-vocabulary')).toEqual([]);
  });

  it('is reachable from the core, since the core derives its events from it', () => {
    expect([...reachableFrom('estate-verify')]).toContain('estate-vocabulary');
  });

  it('is reachable from the action policy, which classifies by reason kind', () => {
    expect([...reachableFrom('estate-action')]).toContain('estate-vocabulary');
  });
});

// ---- the second leaf ----
// The event primitives -- DigestSchema, digestOf, TimestampSchema, the two W3C
// id schemas, the schema version and the producer -- were declared in
// estate-verify.ts AND again in estate-events.ts while the observation event
// was being built. Two declarations of one contract is the duplicate-type
// -definition shape 2026 guidance calls TYPE DEBT: it "accumulates silently",
// "compounds", and is to be treated like a failing test rather than recorded
// for later. The declarations now live in the leaf and estate-verify.ts
// re-exports them, so consumers resolve unchanged.
//
// It MUST stay a leaf. The moment it imports anything from this arc it can
// join a cycle, and the event schemas that extend its envelope are exactly the
// module-scope reads that make a cycle throw on load order alone.
describe('the event primitives are a leaf', () => {
  it('imports no local module at all', () => {
    expect(localImports('estate-events')).toEqual([]);
  });

  it('is reachable from the core, which re-exports its primitives', () => {
    expect([...reachableFrom('estate-verify')]).toContain('estate-events');
  });

  it('is reachable from the observation boundary, which builds events from it', () => {
    expect([...reachableFrom('estate-gather')]).toContain('estate-events');
  });

  // The duplication that prompted the split must not come back: the core may
  // RE-EXPORT these names but must not DECLARE them.
  it('the core declares none of the primitives it re-exports', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'estate-verify.ts'), 'utf-8');
    for (const declaration of [
      'export const DigestSchema',
      'export function digestOf',
      'export const TimestampSchema',
      'export const TraceIdSchema',
      'export const SpanIdSchema',
      'export const ESTATE_SCHEMA_VERSION',
      'export const ESTATE_PRODUCER',
    ]) {
      expect([declaration, source.includes(declaration)]).toEqual([declaration, false]);
    }
  });
});

describe('the layers run one way', () => {
  // The policy states what a caller may DO; it must not depend on how a verdict
  // is rendered or on the driver that spawns git.
  it('the action policy does not import the core', () => {
    expect(localImports('estate-action')).not.toContain('estate-verify');
  });

  it('the action policy does not import the driver', () => {
    expect(localImports('estate-action')).not.toContain('estate-verify-cli');
  });

  // The core is pure: it may not reach for the shell.
  it('the core does not import the driver', () => {
    expect(localImports('estate-verify')).not.toContain('estate-verify-cli');
  });

  // Nor may it reach DOWN into the observation boundary: estate-gather imports
  // the core for WorktreeState, so the reverse edge would be a cycle.
  it('the core does not import the observation boundary', () => {
    expect(localImports('estate-verify')).not.toContain('estate-gather');
  });

  // And the driver sits on top of both, which is the only legal direction.
  it('the driver imports the core, never the reverse', () => {
    expect(localImports('estate-verify-cli')).toContain('estate-verify');
  });
});

// ---- as const is a compile-time claim; freeze is the runtime one ----
// ESTATE_ACTIONS was declared Object.freeze([...] as const) while the six other
// vocabularies in this arc used a bare `as const`. That reads as the same
// guarantee and is not: `as const` narrows the TYPE and does nothing at
// runtime, so an exported array remained mutable by any consumer that imported
// it.
//
// REASON_KIND is the sharp case. It is the SSOT deciding HALT_STRUCTURAL versus
// HALT_WORK_IN_PROGRESS, so a consumer reassigning one key silently rewrites
// the policy every other consumer branches on -- and nothing in a type system
// that has already compiled can see it.
describe('every exported vocabulary is frozen at RUNTIME, not only as const', () => {
  it('freezes the reason codes', () => {
    expect(Object.isFrozen(ESTATE_REASONS)).toBe(true);
  });

  it('freezes the reason kinds', () => {
    expect(Object.isFrozen(REASON_KINDS)).toBe(true);
  });

  // The policy table: mutable here means the work-in-progress/structural split
  // is rewritable by anything that imports it.
  it('freezes the reason-to-kind table', () => {
    expect(Object.isFrozen(REASON_KIND)).toBe(true);
  });

  it('freezes the action vocabulary', () => {
    expect(Object.isFrozen(ESTATE_ACTIONS)).toBe(true);
  });

  it('freezes the action-to-exit map', () => {
    expect(Object.isFrozen(ACTION_EXIT)).toBe(true);
  });

  it('freezes the unreadable reasons', () => {
    expect(Object.isFrozen(UNREADABLE_REASONS)).toBe(true);
  });

  it('freezes the unobservable reasons', () => {
    expect(Object.isFrozen(UNOBSERVABLE_REASONS)).toBe(true);
  });

  it('freezes both severity vocabularies', () => {
    expect(Object.isFrozen(SEVERITY_TEXTS)).toBe(true);
    expect(Object.isFrozen(SEVERITY_NUMBERS)).toBe(true);
  });

  // The property stated once over everything, so a NEW vocabulary is covered
  // the moment it joins this list rather than needing its own test.
  it('freezes every vocabulary the arc exports', () => {
    const vocabularies = [
      ESTATE_REASONS, REASON_KINDS, REASON_KIND, ESTATE_ACTIONS,
      ACTION_EXIT, UNREADABLE_REASONS, UNOBSERVABLE_REASONS,
      SEVERITY_TEXTS, SEVERITY_NUMBERS,
    ];
    for (const v of vocabularies) {
      expect(Object.isFrozen(v)).toBe(true);
    }
  });
});

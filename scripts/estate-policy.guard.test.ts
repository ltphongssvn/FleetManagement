// scripts/estate-policy.guard.test.ts
// THE POLICY IS AUDITABLE ONLY IF SOMETHING CHECKS IT.
//
// WHAT THIS CLOSES. estate-policy.ts made the rules one frozen, versioned,
// digestible value, and every emitted event now carries policy_digest beside
// estate_digest and source_digest. That is the third axis of one
// discrimination: source_digest separates "the estate moved" from "the parser
// changed", and policy_digest separates both from "the RULES changed".
//
// But a digest nothing verifies is decoration. The failure this session already
// produced once, in a different file, is exactly the shape to avoid:
// minimumReleaseAgeExclude in pnpm-workspace.yaml is a real supply-chain
// control that no test asserts, so a turbo bump raised the pin and left the
// exclude behind and every gate stayed green. A value that exists and is
// checked by nothing is a value that drifts on the next change.
//
// So these assert the RELATIONSHIP, not the constant: that the digest on an
// emitted event is the digest OF the policy that produced it, and that the
// digest actually moves when the policy does. A test pinning a literal hash
// would fail on every legitimate policy edit and teach the next reader to
// update the literal without thinking -- which is the treadmill, not a guard.
import { describe, it, expect } from 'vitest';
import {
  ESTATE_POLICY,
  ESTATE_POLICY_VERSION,
  EstatePolicySchema,
  actionUnder,
  policyDigestOf,
  reasonsUnder,
  type EstatePolicy,
} from './estate-policy.js';
import {
  ESTATE_REASONS,
  REASON_KINDS,
} from './estate-vocabulary.js';
import {
  TimestampSchema,
  classifyEstate,
  createWorktreeState,
  decideEstate,
  digestOf,
  estateDigest,
  estateTelemetry,
  estateStaleEvent,
  observedFixture,
  unobservableFixture,
  unreadableEstateEvent,
} from './estate-verify.js';

const AT = TimestampSchema.parse('2026-01-01T00:00:00.000Z');
const SRC = digestOf('worktree /c/a');
const DIRTY = createWorktreeState({ path: '/c/a', dirtyFileCount: 1 });

/** A policy that differs from the default in ONE auditable way: the precedence
 *  order is reversed, so a worktree that is both dirty and prunable reports
 *  work-in-progress instead of structural. Built through the schema, so a
 *  variant that stops satisfying the contract fails at construction. */
const REVERSED: EstatePolicy = EstatePolicySchema.parse({
  ...ESTATE_POLICY,
  kind_precedence: ['work-in-progress', 'structural'],
});

describe('the policy is a parsed value, not an object literal', () => {
  it('parses against its own schema, so a malformed policy cannot exist', () => {
    expect(EstatePolicySchema.safeParse(ESTATE_POLICY).success).toBe(true);
  });

  it('is FROZEN at runtime, not merely as const', () => {
    expect(Object.isFrozen(ESTATE_POLICY)).toBe(true);
  });

  // TOTALITY. A reason with no kind would classify as undefined and silently
  // never reach a halt; a reason with no trigger would never be raised at all.
  it('classifies EVERY reason the vocabulary declares', () => {
    expect(Object.keys(ESTATE_POLICY.reason_kind).sort())
      .toEqual([...ESTATE_REASONS].sort());
  });

  it('gives EVERY reason a trigger field', () => {
    expect(Object.keys(ESTATE_POLICY.reason_trigger).sort())
      .toEqual([...ESTATE_REASONS].sort());
  });

  // A precedence list missing a kind means that kind can never decide a halt.
  it('orders EVERY kind, so precedence is total', () => {
    expect([...ESTATE_POLICY.kind_precedence].sort())
      .toEqual([...REASON_KINDS].sort());
  });

  it('REJECTS a policy naming a trigger field that does not exist', () => {
    const bad = { ...ESTATE_POLICY, reason_trigger: { ...ESTATE_POLICY.reason_trigger, dirty: 'noSuchField' } };
    expect(EstatePolicySchema.safeParse(bad).success).toBe(false);
  });
});

describe('policyDigestOf: the digest tracks the policy', () => {
  it('is stable across repeated calls on the same policy', () => {
    expect(policyDigestOf(ESTATE_POLICY)).toBe(policyDigestOf(ESTATE_POLICY));
  });

  it('is a sha256 hex string, like every other digest in this arc', () => {
    expect(policyDigestOf(ESTATE_POLICY)).toMatch(/^[0-9a-f]{64}$/);
  });

  // THE PROPERTY THAT MAKES IT AN AUDIT TRAIL. Reordering precedence changes
  // the VERDICT, so it must change the digest -- otherwise two runs under
  // different rules would be indistinguishable in the event stream.
  it('CHANGES when the precedence order changes', () => {
    expect(policyDigestOf(REVERSED)).not.toBe(policyDigestOf(ESTATE_POLICY));
  });

  it('CHANGES when a reason moves to a different kind', () => {
    const moved = EstatePolicySchema.parse({
      ...ESTATE_POLICY,
      reason_kind: { ...ESTATE_POLICY.reason_kind, locked: 'work-in-progress' },
    });
    expect(policyDigestOf(moved)).not.toBe(policyDigestOf(ESTATE_POLICY));
  });

  it('CHANGES when the policy version changes', () => {
    const bumped = { ...ESTATE_POLICY, policy_version: '9.9.9' };
    expect(policyDigestOf(bumped as EstatePolicy)).not.toBe(policyDigestOf(ESTATE_POLICY));
  });
});

// THE BINDING. Every event that carries advice must name the rules behind it,
// including the unreadable path -- REPAIR_TOOLING is a recommendation too, and
// omitting the digest there would make it the one place advice arrives
// unattributed.
describe('every emitted event names the policy that produced its advice', () => {
  it('a verdict carries the digest of the default policy', () => {
    const e = estateTelemetry(classifyEstate([DIRTY]), null, estateDigest([DIRTY]), AT);
    expect(e.policy_digest).toBe(policyDigestOf(ESTATE_POLICY));
  });

  it('an unreadable event carries it, since REPAIR_TOOLING is advice too', () => {
    expect(unreadableEstateEvent('git-failed', AT).policy_digest)
      .toBe(policyDigestOf(ESTATE_POLICY));
  });

  it('a stale event carries it, since REREAD_ESTATE is advice too', () => {
    expect(estateStaleEvent(digestOf('a'), digestOf('b'), AT).policy_digest)
      .toBe(policyDigestOf(ESTATE_POLICY));
  });

  // The decider is where an INJECTED policy could otherwise pass unrecorded.
  it('a decision under an INJECTED policy names THAT policy, not the default', () => {
    const d = decideEstate(observedFixture([DIRTY], SRC), null, null, AT, REVERSED);
    expect(d.event.policy_digest).toBe(policyDigestOf(REVERSED));
    expect(d.event.policy_digest).not.toBe(policyDigestOf(ESTATE_POLICY));
  });

  it('an unobservable decision under an injected policy names it too', () => {
    const d = decideEstate(unobservableFixture('git-failed'), null, null, AT, REVERSED);
    expect(d.event.policy_digest).toBe(policyDigestOf(REVERSED));
  });
});

// The point of injectability: a caller can reason counterfactually, and the
// event says which world the answer came from. Without the digest this is the
// confused-deputy shape -- advice whose derivation nobody downstream can check.
describe('a different policy produces a different verdict, visibly', () => {
  const BOTH = createWorktreeState({ path: '/c/b', dirtyFileCount: 1, prunable: true });

  it('the DEFAULT policy reports structural for a mixed worktree', () => {
    expect(actionUnder(reasonsUnder(BOTH), ESTATE_POLICY)).toBe('HALT_STRUCTURAL');
  });

  it('the REVERSED policy reports work-in-progress for the same worktree', () => {
    expect(actionUnder(reasonsUnder(BOTH, REVERSED), REVERSED))
      .toBe('HALT_WORK_IN_PROGRESS');
  });

  // Same estate, different rules, different advice -- and the digests differ,
  // so a consumer diffing two events can tell WHY without guessing.
  it('the two verdicts are distinguishable by policy_digest alone', () => {
    const under = (p: EstatePolicy): string =>
      decideEstate(observedFixture([BOTH], SRC), null, null, AT, p).event.policy_digest;
    expect(under(ESTATE_POLICY)).not.toBe(under(REVERSED));
  });
});

describe('the policy version is independent of the event version', () => {
  it('is semver, so a consumer can reason about the KIND of rule change', () => {
    expect(ESTATE_POLICY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The two version even if they happen to agree today: the event version moves
  // when the PAYLOAD shape changes, the policy version when the RULES change,
  // and conflating them means one change forces a false signal in the other.
  it('is carried inside the policy, not derived from the schema version', () => {
    expect(ESTATE_POLICY.policy_version).toBe(ESTATE_POLICY_VERSION);
  });
});

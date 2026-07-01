// scripts/ci/resolve-ci-sha.test.ts
// Contract for the SHA-resolution logic that the railway-deploy.yml gate job
// feeds to dorny/paths-filter@v4 as its diff base.
//
// Original bug: inline 'base: HEAD~1' under workflow_run context exit-128'd
// (merge-base HEAD~1 against a ref absent from the shallow clone). Fixed by
// pre-resolving to a real commit SHA in a pure, unit-tested function.
//
// This revision (2026): the parent-only base is a ONE-COMMIT diff window. If an
// app change landed a promote-cycle back, or was separated from the deploy
// trigger by an intervening CI-infra commit, the parent..current diff misses it
// -> paths-filter reports the service unchanged -> a stale image ships (the
// exact ops-web under-build we hit). The fix makes the base the last
// SUCCESSFULLY-DEPLOYED SHA when one is known: diffing last-deployed..current
// captures the COMPLETE change set since that service last shipped, immune to
// intervening commits, without needing full git history (so the shallow-clone
// gate is preserved). Precedence: last-deployed (when known and != current) ->
// parent -> self-fallback.

import { describe, it, expect } from 'vitest';
import {
  ciEnvSchema,
  pickCurrentSha,
  resolveBaseSha,
} from './resolve-ci-sha.ts';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const PARENT_SHA = 'c'.repeat(40);
const DEPLOYED_SHA = 'd'.repeat(40);

describe('ciEnvSchema', () => {
  it('accepts a valid push event env', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'push',
      GITHUB_SHA: VALID_SHA,
    });
    expect(env.GITHUB_EVENT_NAME).toBe('push');
    expect(env.GITHUB_SHA).toBe(VALID_SHA);
  });
  it('accepts workflow_run env with head_sha override', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_SHA: VALID_SHA,
      WORKFLOW_RUN_HEAD_SHA: OTHER_SHA,
    });
    expect(env.WORKFLOW_RUN_HEAD_SHA).toBe(OTHER_SHA);
  });
  it('rejects a malformed SHA (not 40 hex chars)', () => {
    const r = ciEnvSchema.safeParse({
      GITHUB_EVENT_NAME: 'push',
      GITHUB_SHA: 'not-a-sha',
    });
    expect(r.success).toBe(false);
  });
  it('rejects an empty event name', () => {
    const r = ciEnvSchema.safeParse({
      GITHUB_EVENT_NAME: '',
      GITHUB_SHA: VALID_SHA,
    });
    expect(r.success).toBe(false);
  });
});

describe('pickCurrentSha', () => {
  it('returns workflow_run.head_sha for workflow_run events', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_SHA: VALID_SHA,
      WORKFLOW_RUN_HEAD_SHA: OTHER_SHA,
    });
    expect(pickCurrentSha(env)).toBe(OTHER_SHA);
  });
  it('returns GITHUB_SHA for workflow_dispatch (manual trigger)', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_SHA: VALID_SHA,
    });
    expect(pickCurrentSha(env)).toBe(VALID_SHA);
  });
  it('returns GITHUB_SHA for push events', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'push',
      GITHUB_SHA: VALID_SHA,
    });
    expect(pickCurrentSha(env)).toBe(VALID_SHA);
  });
  it('falls back to GITHUB_SHA when workflow_run head_sha is missing', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_SHA: VALID_SHA,
    });
    expect(pickCurrentSha(env)).toBe(VALID_SHA);
  });
  it('falls back to GITHUB_SHA when workflow_run head_sha is an EMPTY STRING', () => {
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_SHA: VALID_SHA,
      WORKFLOW_RUN_HEAD_SHA: '',
    });
    expect(env.WORKFLOW_RUN_HEAD_SHA).toBeUndefined();
    expect(pickCurrentSha(env)).toBe(VALID_SHA);
  });
});

describe('resolveBaseSha', () => {
  // Precedence: last-deployed (when known and != current) -> parent ->
  // self-fallback. The last-deployed base is the fix for the one-commit-window
  // under-build; parent and self-fallback are retained for the no-prior-deploy
  // and initial-commit cases.

  it('prefers the last-deployed SHA when one is known (the fix)', () => {
    // A prior successful deploy exists -> diff last-deployed..current, the
    // COMPLETE change window since that service last shipped. This is what
    // catches an app change that an intervening CI-infra commit would have
    // pushed outside the parent..current window.
    const r = resolveBaseSha(VALID_SHA, PARENT_SHA, DEPLOYED_SHA);
    expect(r.baseSha).toBe(DEPLOYED_SHA);
    expect(r.strategy).toBe('last-deployed');
  });
  it('uses last-deployed even when there is no parent', () => {
    const r = resolveBaseSha(VALID_SHA, null, DEPLOYED_SHA);
    expect(r.baseSha).toBe(DEPLOYED_SHA);
    expect(r.strategy).toBe('last-deployed');
  });
  it('falls through to parent when last-deployed EQUALS current (re-run/no new deploy)', () => {
    // The current commit was itself the last successful deploy (a re-run or a
    // no-op redeploy). Diffing current..current would skip everything; fall to
    // the parent window instead so a genuine change is still detected.
    const r = resolveBaseSha(VALID_SHA, PARENT_SHA, VALID_SHA);
    expect(r.baseSha).toBe(PARENT_SHA);
    expect(r.strategy).toBe('parent');
  });
  it('falls through to parent when last-deployed is null (no prior deploy)', () => {
    const r = resolveBaseSha(VALID_SHA, PARENT_SHA, null);
    expect(r.baseSha).toBe(PARENT_SHA);
    expect(r.strategy).toBe('parent');
  });
  it('returns parent SHA when one is provided and no last-deployed (normal case)', () => {
    const r = resolveBaseSha(VALID_SHA, PARENT_SHA, null);
    expect(r.baseSha).toBe(PARENT_SHA);
    expect(r.strategy).toBe('parent');
  });
  it('falls back to current SHA when neither last-deployed nor parent exists (initial commit)', () => {
    const r = resolveBaseSha(VALID_SHA, null, null);
    expect(r.baseSha).toBe(VALID_SHA);
    expect(r.strategy).toBe('self-fallback');
  });
  it('falls back to current SHA when parent is empty string and no last-deployed', () => {
    const r = resolveBaseSha(VALID_SHA, '', null);
    expect(r.baseSha).toBe(VALID_SHA);
    expect(r.strategy).toBe('self-fallback');
  });
  it('treats an empty-string last-deployed as absent (falls to parent)', () => {
    const r = resolveBaseSha(VALID_SHA, PARENT_SHA, '');
    expect(r.baseSha).toBe(PARENT_SHA);
    expect(r.strategy).toBe('parent');
  });
  it('is deterministic for the same input', () => {
    const a = resolveBaseSha(VALID_SHA, PARENT_SHA, DEPLOYED_SHA);
    const b = resolveBaseSha(VALID_SHA, PARENT_SHA, DEPLOYED_SHA);
    expect(a).toEqual(b);
  });
});

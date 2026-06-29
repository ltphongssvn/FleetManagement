// scripts/ci/resolve-ci-sha.test.ts
// Outside-in RED: contract for the SHA-resolution logic that the
// railway-deploy.yml gate job needs to feed dorny/paths-filter@v3. The
// inline 'base: HEAD~1' in YAML failed under workflow_run context with
// 'git failed exit 128' because paths-filter tried to merge-base HEAD~1
// against a non-existent local ref (the merge commit's source branch
// lineage). Extracting the resolution into a pure TS function makes
// the logic unit-testable across the git states that bit us (shallow
// clone, workflow_run, workflow_dispatch, initial commit) without
// pushing to remote. Imports a module that does not exist yet -> RED.

import { describe, it, expect } from 'vitest';
import {
  ciEnvSchema,
  pickCurrentSha,
  resolveBaseSha,
} from './resolve-ci-sha.ts';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const PARENT_SHA = 'c'.repeat(40);

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
  // The workflow_run event runs from main's HEAD, but the SHA we want
  // to resolve a base FOR is the commit that triggered the upstream CI
  // run -- which may or may not still be main's tip. Prefer
  // workflow_run.head_sha when present; otherwise github.sha.
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
    // Defensive: if workflow_run fires but the head_sha env var did
    // not propagate (e.g. an upstream workflow that did not surface
    // it), we still need a usable SHA. github.sha is the next-best.
    const env = ciEnvSchema.parse({
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_SHA: VALID_SHA,
    });
    expect(pickCurrentSha(env)).toBe(VALID_SHA);
  });
  it('falls back to GITHUB_SHA when workflow_run head_sha is an EMPTY STRING', () => {
    // Regression: GitHub Actions yields '' (not undefined) for
    // ${{ github.event.workflow_run.head_sha }} when the deploy workflow is
    // invoked via workflow_dispatch (e.g. the auto-promote dispatch). The
    // schema must normalize '' -> undefined so parsing succeeds and we fall
    // back to GITHUB_SHA, instead of crashing on the 40-hex-char check (which
    // failed the production deploy after a release promotion).
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
  // The decisive bug: paths-filter v3 'base: HEAD~1' under workflow_run
  // context tried merge-base HEAD~1 develop and exit-128'd. The fix is
  // to pre-resolve HEAD~1 to a real commit SHA in a step BEFORE the
  // paths-filter step. This pure function encodes the deterministic
  // fallback rules for the cases where no parent exists (initial
  // commit, shallow clone too shallow, git command failure).
  it('returns parent SHA when one is provided (normal case)', () => {
    const r = resolveBaseSha(VALID_SHA, PARENT_SHA);
    expect(r.baseSha).toBe(PARENT_SHA);
    expect(r.strategy).toBe('parent');
  });
  it('falls back to current SHA when no parent exists (initial commit)', () => {
    // No parent -> paths-filter compares current SHA to itself ->
    // empty diff -> all service filters report no changes -> all
    // deploys skip. Safe default for a freshly-initialized repo.
    const r = resolveBaseSha(VALID_SHA, null);
    expect(r.baseSha).toBe(VALID_SHA);
    expect(r.strategy).toBe('self-fallback');
  });
  it('falls back to current SHA when parent is empty string', () => {
    // Defensive: git rev-parse HEAD~1 may emit empty string on
    // shallow clones rather than failing outright; normalize that
    // to the same fallback path as null.
    const r = resolveBaseSha(VALID_SHA, '');
    expect(r.baseSha).toBe(VALID_SHA);
    expect(r.strategy).toBe('self-fallback');
  });
  it('is deterministic for the same input', () => {
    const a = resolveBaseSha(VALID_SHA, PARENT_SHA);
    const b = resolveBaseSha(VALID_SHA, PARENT_SHA);
    expect(a).toEqual(b);
  });
});

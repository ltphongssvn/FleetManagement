// packages/sync-protocol/test/deploy-version-contract.test.ts
// RED: the build-provenance payload every deployable service must answer.
//
// WHY A SHARED CONTRACT. CI asserts it: railway-deploy stamps GIT_SHA as a
// Railway service variable, then deploy-stamp --verify fetches a version
// endpoint and fails the deploy unless the LIVE sha equals the DEPLOYED sha.
// Three emitters (api, ops-web, worker), one CI consumer -- so ONE schema.
//
// THE GAP THIS CLOSES. Only api answered a version endpoint. ops-web and worker
// were gated by liveness alone -- /login 200 and a sleep -- and the PREVIOUS
// container answers both. A failed ops-web deploy leaves the old build serving
// a healthy 200, so liveness cannot distinguish "new version live" from "old
// version still up": exactly the failure deploy-stamp exists to catch, wired to
// one service out of three.
//
// unknown stays REPORTABLE rather than schema-rejected, deliberately.
// evaluateDeployedSha already fails closed on it with a precise diagnosis --
// "the deploy did not stamp GIT_SHA". Rejecting it at the schema would leave
// the endpoint unable to emit a parseable payload, degrading that message to
// "version payload was not an object" and losing the cause.
import { describe, it, expect } from 'vitest';
import {
  DeployVersionSchema,
  buildDeployVersion,
  UNKNOWN_VERSION_FIELD,
} from '../src/deploy-version-contract.js';

const SHA = 'bbf11c3aa1d4e5f60718293a4b5c6d7e8f901234';
// The clock is INJECTED, never read inside the builder: a pure function whose
// output changes between identical calls is not verifiable, and a drifting
// buildTime would make the payload non-reproducible in CI logs.
const FIXED_NOW = '2026-08-03T09:00:00.000Z';
const at = (): string => FIXED_NOW;

describe('DeployVersionSchema', () => {
  it('accepts the payload api already serves', () => {
    expect(DeployVersionSchema.safeParse({
      sha: SHA, shortSha: SHA.slice(0, 7), branch: 'main', buildTime: FIXED_NOW,
    }).success).toBe(true);
  });

  it('rejects a payload with no sha -- the one field the CI gate reads', () => {
    expect(DeployVersionSchema.safeParse({
      shortSha: SHA.slice(0, 7), branch: 'main', buildTime: FIXED_NOW,
    }).success).toBe(false);
  });

  it('rejects a sha that is not 40 lowercase hex', () => {
    expect(DeployVersionSchema.safeParse({
      sha: 'not-a-sha', shortSha: 'not-a-s', branch: 'main', buildTime: FIXED_NOW,
    }).success).toBe(false);
  });

  it('is closed: an unexpected field is rejected, not silently carried', () => {
    expect(DeployVersionSchema.safeParse({
      sha: SHA, shortSha: SHA.slice(0, 7), branch: 'main', buildTime: FIXED_NOW,
      secret: 'leaked',
    }).success).toBe(false);
  });
});

describe('buildDeployVersion', () => {
  it('derives every field from the stamped environment', () => {
    expect(buildDeployVersion({
      GIT_SHA: SHA, GIT_BRANCH: 'main', BUILD_TIME: FIXED_NOW,
    }, at)).toStrictEqual({
      sha: SHA, shortSha: SHA.slice(0, 7), branch: 'main', buildTime: FIXED_NOW,
    });
  });

  it('derives shortSha FROM the sha rather than carrying a separate value', () => {
    expect(buildDeployVersion({ GIT_SHA: SHA }, at).shortSha).toBe(SHA.slice(0, 7));
  });

  // Preserved from health.controller.ts, and the reason the gate could never
  // pass before: Docker substitutes an UNPASSED ARG with the EMPTY STRING, so a
  // Dockerfile baking ENV GIT_SHA=<unpassed ARG> ships a set-but-BLANK variable.
  // Nullish coalescing counts blank as PRESENT, so that baked empty value
  // shadowed the sha injected at runtime and the endpoint reported an empty sha
  // in production indefinitely.
  it('treats a blank stamped value as ABSENT, never as a value', () => {
    const v = buildDeployVersion({ GIT_SHA: '', GIT_BRANCH: '   ' }, at);
    expect(v.sha).toBe(UNKNOWN_VERSION_FIELD);
    expect(v.branch).toBe(UNKNOWN_VERSION_FIELD);
  });

  it('falls back to the Railway-injected names when the stamped ones are absent', () => {
    const v = buildDeployVersion({ RAILWAY_GIT_COMMIT_SHA: SHA, RAILWAY_GIT_BRANCH: 'main' }, at);
    expect(v.sha).toBe(SHA);
    expect(v.branch).toBe('main');
  });

  it('prefers the explicitly stamped sha over the Railway-injected one', () => {
    const other = 'a'.repeat(40);
    expect(buildDeployVersion({ GIT_SHA: SHA, RAILWAY_GIT_COMMIT_SHA: other }, at).sha).toBe(SHA);
  });

  it('trims a padded variable so it still verifies', () => {
    expect(buildDeployVersion({ GIT_SHA: '  ' + SHA + '  ' }, at).sha).toBe(SHA);
  });

  it('reports unknown rather than throwing when nothing was stamped', () => {
    const v = buildDeployVersion({}, at);
    expect(v.sha).toBe(UNKNOWN_VERSION_FIELD);
    expect(v.shortSha).toBe(UNKNOWN_VERSION_FIELD);
  });

  it('uses the injected clock for buildTime when none was stamped', () => {
    expect(buildDeployVersion({}, at).buildTime).toBe(FIXED_NOW);
  });

  it('is pure: identical input yields identical output', () => {
    expect(buildDeployVersion({ GIT_SHA: SHA }, at))
      .toStrictEqual(buildDeployVersion({ GIT_SHA: SHA }, at));
  });
});

// AXIS 1: process.env is a trust boundary, so buildDeployVersion parses its own
// output rather than asserting it. Without this, a malformed stamp is served as
// though it were provenance and fails later in CI as an opaque sha mismatch --
// blaming the deploy for what is actually a stamping bug. Failing here names
// the offending value at the source.
describe('buildDeployVersion validates at the trust boundary', () => {
  it('throws on a stamped value that is not a 40-hex sha', () => {
    expect(() => buildDeployVersion({ GIT_SHA: 'v2.65.0' }, at)).toThrow();
    expect(() => buildDeployVersion({ GIT_SHA: SHA.slice(0, 20) }, at)).toThrow();
  });

  it('throws on uppercase hex rather than silently reporting a sha CI cannot match', () => {
    expect(() => buildDeployVersion({ GIT_SHA: SHA.toUpperCase() }, at)).toThrow();
  });

  // The two legitimate states must never throw: a correctly stamped service and
  // an unstamped one (local dev, or a deploy that failed to stamp) both have to
  // answer, the latter with the sentinel the gate rejects by name.
  it('never throws for a correctly stamped service', () => {
    expect(() => buildDeployVersion({ GIT_SHA: SHA, GIT_BRANCH: 'main' }, at)).not.toThrow();
  });

  it('never throws for an unstamped service', () => {
    expect(() => buildDeployVersion({}, at)).not.toThrow();
  });
});

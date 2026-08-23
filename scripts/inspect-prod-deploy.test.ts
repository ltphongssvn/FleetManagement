// File: FleetManagement/scripts/inspect-prod-deploy.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeDeployVerdict,
  parseShaFromVersionPayload,
  looksLikeUrl,
} from './inspect-prod-deploy.js';

describe('computeDeployVerdict', () => {
  it('EFFECTIVE + exit 0 when fix is in both base and live', () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: true, aheadCount: 0 });
    expect(v.verdict).toBe('EFFECTIVE');
    expect(v.exitCode).toBe(0);
  });

  it('REDEPLOY-NEEDED + exit 1 when fix is in base but not live', () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: false, aheadCount: 3 });
    expect(v.verdict).toBe('REDEPLOY-NEEDED');
    expect(v.exitCode).toBe(1);
  });

  it('NOT-PROMOTED + exit 1 when fix is not even in base', () => {
    const v = computeDeployVerdict({ fixInBase: false, fixInLive: false, aheadCount: 7 });
    expect(v.verdict).toBe('NOT-PROMOTED');
    expect(v.exitCode).toBe(1);
  });

  it('surfaces aheadCount in the rendered lines', () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: false, aheadCount: 3 });
    expect(v.lines.join(String.fromCharCode(10))).toContain('3');
  });

  it('always emits the RAILWAY MANUAL CHECK reminder', () => {
    const v = computeDeployVerdict({ fixInBase: true, fixInLive: true, aheadCount: 0 });
    expect(v.lines.join(String.fromCharCode(10))).toContain('RAILWAY MANUAL CHECK');
  });
});

describe('parseShaFromVersionPayload', () => {
  it('extracts sha from a /health/version JSON payload', () => {
    const sha = parseShaFromVersionPayload(
      JSON.stringify({
        sha: 'commit-sha-fixture',
        shortSha: 'commit-',
        branch: 'main',
        buildTime: 't',
      }),
    );
    expect(sha).toBe('commit-sha-fixture');
  });
  it('throws when payload has no sha', () => {
    expect(() => parseShaFromVersionPayload(JSON.stringify({ status: 'ok' }))).toThrow();
  });
  it('throws when sha is the unknown sentinel', () => {
    expect(() => parseShaFromVersionPayload(JSON.stringify({ sha: 'unknown' }))).toThrow();
  });
});

describe('looksLikeUrl', () => {
  it('true for http/https, false for a bare sha', () => {
    expect(looksLikeUrl('https://xe.vominhchau.com/health/version')).toBe(true);
    expect(looksLikeUrl('646f99c')).toBe(false);
  });
});

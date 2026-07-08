// apps/ops-web/test/cf-web-analytics.test.tsx
// RED-first: the Cloudflare Web Analytics beacon must be part of the
// SERVER-RENDERED tree (root layout <head>), not injected into <body> by the
// edge -- edge injection into <body> is what broke React 19 hydration (#418).
// A pure builder returns the next/script props from the token; absent token
// -> null (dev/CI render nothing, no snippet). Asserting the builder keeps the
// async server layout out of the unit (RSC + next/headers are integration).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cfBeaconScriptProps } from '../src/features/analytics/cf-web-analytics';

describe('cfBeaconScriptProps', () => {
  it('returns null when no token is configured (dev/CI: nothing injected)', () => {
    expect(cfBeaconScriptProps(undefined)).toBeNull();
    expect(cfBeaconScriptProps('')).toBeNull();
  });

  it('builds afterInteractive beacon script props from the token', () => {
    const value = randomBytes(16).toString('hex');
    const props = cfBeaconScriptProps(value);
    expect(props).not.toBeNull();
    expect(props?.src).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(props?.strategy).toBe('afterInteractive');
    expect(props?.['data-cf-beacon']).toBe(JSON.stringify({ token: value }));
  });
});

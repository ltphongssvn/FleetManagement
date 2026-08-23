// apps/ops-web/test/api-url.test.ts
// Factor III (Config): the internal API base URL is deploy-varying config.
// It must come from FLEET_API_URL, fail fast in production when absent
// (a wrong/placeholder host silently succeeding in prod is the hazard the
// methodology warns about for critical resource identifiers), and may fall
// back to the compose hostname ONLY in non-production. Mirrors the driver-
// app production HTTPS fail-fast getApiUrl precedent.
import { describe, expect, it } from 'vitest';
import { getApiUrl } from '@/lib/api-url';

describe('ops-web getApiUrl (Factor III)', () => {
  it('returns FLEET_API_URL when set', () => {
    expect(getApiUrl({ FLEET_API_URL: 'https://api.example.com', NODE_ENV: 'production' })).toBe(
      'https://api.example.com',
    );
  });

  it('throws in production when FLEET_API_URL is unset', () => {
    expect(() => getApiUrl({ NODE_ENV: 'production' })).toThrow(/FLEET_API_URL/);
  });

  it('falls back to the compose host in non-production when unset', () => {
    expect(getApiUrl({ NODE_ENV: 'development' })).toBe('http://api:3000');
  });
});

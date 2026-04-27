// apps/ops-web/test/version.test.ts
// TDD: verify version helper reads env var (behavioral, not literal).
import { describe, it, expect, afterEach } from 'vitest';
import { getAppVersion } from '@/lib/version';

describe('@fleet/ops-web - getAppVersion', () => {
  const original = process.env['NEXT_PUBLIC_APP_VERSION'];

  afterEach(() => {
    if (original === undefined) delete process.env['NEXT_PUBLIC_APP_VERSION'];
    else process.env['NEXT_PUBLIC_APP_VERSION'] = original;
  });

  it('returns the value from NEXT_PUBLIC_APP_VERSION', () => {
    process.env['NEXT_PUBLIC_APP_VERSION'] = '1.2.3';
    expect(getAppVersion()).toBe('1.2.3');
  });

  it('returns "unknown" when env var is missing', () => {
    delete process.env['NEXT_PUBLIC_APP_VERSION'];
    expect(getAppVersion()).toBe('unknown');
  });
});

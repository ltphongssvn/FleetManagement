// apps/ops-web/test/env.test.ts
// TDD: env validation behavior.
import { describe, it, expect } from 'vitest';
import { loadEnv } from '@/env';

describe('@fleet/ops-web - loadEnv', () => {
  it('accepts valid env', () => {
    const e = loadEnv({ NEXT_PUBLIC_APP_VERSION: '1.2.3', NODE_ENV: 'test' });
    expect(e.NEXT_PUBLIC_APP_VERSION).toBe('1.2.3');
  });

  it('defaults version when missing', () => {
    expect(loadEnv({}).NEXT_PUBLIC_APP_VERSION).toBe('0.0.0');
  });

  it('rejects malformed version', () => {
    expect(() => loadEnv({ NEXT_PUBLIC_APP_VERSION: 'abc' })).toThrow(/Invalid env/);
  });
});

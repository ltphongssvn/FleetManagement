// workers/main-worker/test/config-gemini.test.ts
// RED (phieu-can): worker config carries the Gemini adapter env surface.
// GEMINI_API_KEY optional (extraction degrades to ports-not-configured skip);
// GEMINI_MODEL defaults to gemini-3.5-flash (GA): wrong kg on a stop is a
// business-unacceptable output, so the accuracy/hallucination-reduction tier
// wins over cost (owner decision, see feature PR). Env-overridable for
// cost A/B (e.g. gemini-2.5-flash) with zero code change.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const BASE = { REDIS_URL: 'redis://localhost:6379' };

describe('config: Gemini extraction keys', () => {
  it('defaults GEMINI_MODEL to gemini-3.5-flash with no key set', () => {
    const c = loadConfig({ ...BASE } as NodeJS.ProcessEnv);
    expect(c.GEMINI_API_KEY).toBeUndefined();
    expect(c.GEMINI_MODEL).toBe('gemini-3.5-flash');
  });

  it('accepts an explicit key + model override (cost A/B downgrade path)', () => {
    const c = loadConfig({ ...BASE, GEMINI_API_KEY: 'k-abc', GEMINI_MODEL: 'gemini-2.5-flash' } as NodeJS.ProcessEnv);
    expect(c.GEMINI_API_KEY).toBe('k-abc');
    expect(c.GEMINI_MODEL).toBe('gemini-2.5-flash');
  });

  it('rejects an empty GEMINI_API_KEY (set-but-blank is a config bug)', () => {
    expect(() => loadConfig({ ...BASE, GEMINI_API_KEY: '' } as NodeJS.ProcessEnv)).toThrow(/Invalid environment/);
  });
});

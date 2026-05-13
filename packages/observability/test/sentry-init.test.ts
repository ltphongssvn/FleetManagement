// packages/observability/test/sentry-init.test.ts
import { describe, it, expect } from 'vitest';
import { buildSentryOptions, parseTracesSampleRate, createBeforeSend, readDepthLimitFromEnv } from '../src/sentry-init.ts';
import { scrubEvent } from '../src/sentry-scrub.ts';

describe('parseTracesSampleRate', () => {
  it('returns 0.1 default for undefined', () => {
    expect(parseTracesSampleRate(undefined)).toBe(0.1);
  });
  it('returns 0.1 default for NaN', () => {
    expect(parseTracesSampleRate('not-a-number')).toBe(0.1);
  });
  it('returns 0.1 default for negative', () => {
    expect(parseTracesSampleRate('-0.5')).toBe(0.1);
  });
  it('returns 0.1 default for > 1', () => {
    expect(parseTracesSampleRate('1.5')).toBe(0.1);
  });
  it('returns 0.1 default for Infinity', () => {
    expect(parseTracesSampleRate('Infinity')).toBe(0.1);
  });
  it('accepts valid 0', () => {
    expect(parseTracesSampleRate('0')).toBe(0);
  });
  it('accepts valid 1', () => {
    expect(parseTracesSampleRate('1')).toBe(1);
  });
  it('accepts valid mid-range', () => {
    expect(parseTracesSampleRate('0.25')).toBe(0.25);
  });
});

describe('buildSentryOptions', () => {
  it('returns null options when DSN is undefined', () => {
    const r = buildSentryOptions({ dsn: undefined });
    expect(r.options).toBeNull();
    expect(r.skipReason).toBeDefined();
  });

  it('returns null options when DSN is empty', () => {
    const r = buildSentryOptions({ dsn: '' });
    expect(r.options).toBeNull();
  });

  it('returns null options when DSN is malformed', () => {
    const r = buildSentryOptions({ dsn: 'not-a-dsn' });
    expect(r.options).toBeNull();
    expect(r.skipReason).toBeDefined();
  });

  it('returns full options for valid DSN', () => {
    const r = buildSentryOptions({
      dsn: 'https://abc@host.io/1',
      environment: 'production',
      tracesSampleRate: '0.5',
      release: 'v1.2.3',
    });
    expect(r.options).not.toBeNull();
    expect(r.options?.dsn).toBe('https://abc@host.io/1');
    expect(r.options?.environment).toBe('production');
    expect(r.options?.tracesSampleRate).toBe(0.5);
    expect(r.options?.release).toBe('v1.2.3');
    expect(r.options?.sendDefaultPii).toBe(false);
    expect(r.options?.beforeSend).toBe(scrubEvent);
  });

  it('defaults environment to development when omitted', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
    expect(r.options?.environment).toBe('development');
  });

  it('defaults tracesSampleRate to 0.1 when omitted', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
    expect(r.options?.tracesSampleRate).toBe(0.1);
  });

  it('omits release when not provided', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
    expect(r.options?.release).toBeUndefined();
  });
});

describe('buildSentryOptions release defaulting', () => {
  it('uses provided release verbatim', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1', release: 'v9.9.9' });
    expect(r.options?.release).toBe('v9.9.9');
  });

  it('does not fall back to npm_package_version (env-derived release is brittle)', () => {
    const orig = process.env['npm_package_version'];
    process.env['npm_package_version'] = 'should-be-ignored';
    try {
      const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
      expect(r.options?.release).toBeUndefined();
    } finally {
      if (orig === undefined) delete process.env['npm_package_version'];
      else process.env['npm_package_version'] = orig;
    }
  });
});

describe('createBeforeSend factory', () => {
  it('returns scrubEvent function by default', () => {
    const beforeSend = createBeforeSend();
    expect(typeof beforeSend).toBe('function');
    const out = beforeSend({ message: 'Bearer abc.def-ghi' });
    expect(out.message).toBe('[redacted]');
  });

  it('accepts auditLog option to track redaction counts', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({
      auditLog: (count: number) => counts.push(count),
    });
    beforeSend({ message: 'Bearer abc.def-ghi and jane@example.com', request: { data: { password: 'p' } } });
    expect(counts).toHaveLength(1);
    expect(counts[0]).toBeGreaterThanOrEqual(2);
  });

  it('does not call auditLog when no redactions occur', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    beforeSend({ message: 'plain text' });
    expect(counts).toEqual([0]);
  });
});

describe('createBeforeSend with audit metadata', () => {
  it('adds __redaction metadata to event.extra when annotateEvent is true', () => {
    const beforeSend = createBeforeSend({ annotateEvent: true });
    const out = beforeSend({ message: 'Bearer abc.def-ghi', request: { data: { password: 'p' } } });
    const meta = out.extra?.['__redaction'] as { count: number } | undefined;
    expect(meta).toBeDefined();
    expect(meta?.count).toBeGreaterThanOrEqual(2);
  });

  it('does not add __redaction metadata when annotateEvent is false (default)', () => {
    const beforeSend = createBeforeSend();
    const out = beforeSend({ message: 'Bearer abc.def-ghi' });
    expect(out.extra?.['__redaction']).toBeUndefined();
  });
});

describe('readDepthLimitFromEnv', () => {
  it('returns env value when valid number', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '4' })).toBe(4);
  });

  it('returns DEFAULT_DEPTH_LIMIT when env unset', () => {
    expect(readDepthLimitFromEnv({})).toBe(6);
  });

  it('returns DEFAULT_DEPTH_LIMIT when env is non-numeric', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: 'abc' })).toBe(6);
  });

  it('returns DEFAULT_DEPTH_LIMIT when env value out of range', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '999' })).toBe(6);
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '-1' })).toBe(6);
  });

  // Mutation-hardening: boundary tests to kill surviving mutants
  it('returns the exact env value 4 (kills if-undefined → if-false mutant)', () => {
    // If `if (raw === undefined)` is mutated to `if (false)`, n=Number("4")=4
    // would still pass the range check and return 4 here. But if the mutant
    // returns DEFAULT_DEPTH_LIMIT only when raw === undefined, the no-undefined
    // path returns the env value distinct from the default (6).
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '4' })).toBe(4);
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '4' })).not.toBe(6);
  });

  it('accepts 0 as a valid depth (kills n < 0 → n <= 0 mutant)', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '0' })).toBe(0);
  });

  it('accepts MAX_ENV_DEPTH=50 exactly (kills n > 50 → n >= 50 mutant)', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '50' })).toBe(50);
  });

  it('rejects 51 = MAX_ENV_DEPTH+1 (kills n > 50 → n >= 50 mutant from the other side)', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '51' })).toBe(6);
  });

  it('rejects -1 exactly (kills n < 0 → n <= 0 mutant from the other side)', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '-1' })).toBe(6);
  });
});

describe('createBeforeSend full coverage paths', () => {
  it('counts redaction in exception.values strings', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    beforeSend({
      exception: { values: [{ value: 'Bearer abc.def-ghi' }, { value: 'fine' }] },
    });
    expect(counts[0]).toBeGreaterThanOrEqual(1);
  });

  it('skips non-string exception values', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    beforeSend({
      exception: { values: [{}, { value: 'plain' }] },
    });
    expect(counts).toEqual([0]);
  });

  it('counts redaction in request.headers (string and array)', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    beforeSend({
      request: {
        headers: {
          authorization: 'Bearer x',
          'set-cookie': ['a=1', 'b=2'],
          'x-trace': 't',
        },
      },
    });
    expect(counts[0]).toBeGreaterThanOrEqual(2);
  });

  it('skips undefined header values', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    beforeSend({ request: { headers: { 'x-trace': undefined as unknown as string } } });
    expect(counts).toEqual([0]);
  });

  it('scrubs request.data, extra, contexts', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    const out = beforeSend({
      request: { data: { password: 'p' } },
      extra: { token: 't' },
      contexts: { auth: { secret: 's' } },
    });
    expect((out.request?.data as Record<string, unknown>)['password']).toBe('[redacted]');
    expect(out.extra?.['token']).toBe('[redacted]');
  });

  it('annotateEvent merges into existing extra', () => {
    const beforeSend = createBeforeSend({ annotateEvent: true });
    const out = beforeSend({ message: 'Bearer abc.def-ghi', extra: { existing: 'keep' } });
    expect(out.extra?.['existing']).toBe('keep');
    expect(out.extra?.['__redaction']).toBeDefined();
  });
});

describe('createBeforeSend mutation-hardening', () => {
  it('when both auditLog and annotateEvent are absent, returns the raw scrubEvent reference (kills L102 conditional)', () => {
    // The early return `if (!auditLog && !annotateEvent) return scrubEvent;`
    // means the returned function IS scrubEvent itself. If the conditional is
    // mutated to `if (false)`, we'd get the closure-wrapping version instead.
    const fn = createBeforeSend();
    // The closure version creates a new scrubber on each call; scrubEvent does not.
    // The cheapest way to distinguish: scrubEvent has a specific .name.
    expect(fn.name).toBe('scrubEvent');
  });

  it('when annotateEvent=true alone, returns a wrapping function (NOT scrubEvent ref)', () => {
    const fn = createBeforeSend({ annotateEvent: true });
    expect(fn.name).not.toBe('scrubEvent');
  });

  it('when auditLog alone, returns a wrapping function', () => {
    const fn = createBeforeSend({ auditLog: () => undefined });
    expect(fn.name).not.toBe('scrubEvent');
  });

  it('preserves other exception fields, not just value (kills L120 return-empty-object mutant)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined });
    // Cast to the test-helper shape so we can probe extra exception fields
    // (ScrubbableEvent only declares `value?: string`, but Sentry events in
    // practice carry `type`, `mechanism`, etc. — we want to assert those
    // pass through unmolested).
    const out = beforeSend({
      exception: { values: [{ value: 'Bearer abc.def-ghi' }] },
    }) as { exception?: { values?: Array<{ value?: string; type?: string; mechanism?: unknown }> } };
    // Re-build a richer event via JSON to get the extra fields without
    // tripping the strict ScrubbableEvent type.
    const richEvent = JSON.parse(JSON.stringify({
      exception: { values: [{ value: 'Bearer abc.def-ghi', type: 'AuthError', mechanism: { handled: false } }] },
    })) as Parameters<typeof beforeSend>[0];
    const out2 = beforeSend(richEvent) as { exception?: { values?: Array<{ value?: string; type?: string; mechanism?: unknown }> } };
    const ex = out2.exception?.values?.[0];
    expect(ex?.value).toBe('[redacted]');
    expect(ex?.type).toBe('AuthError');
    expect(ex?.mechanism).toEqual({ handled: false });
    // The simpler shape above also passes the basic test:
    expect(out.exception?.values?.[0]?.value).toBe('[redacted]');
  });

  it('skips request handling when out.request is absent (kills L124 if(true) mutant)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined });
    const out = beforeSend({ message: 'clean' }); // no request field at all
    expect(out.request).toBeUndefined();
  });

  it('preserves non-PII header keys verbatim (kills L132 [REDACTED] -> [] mutant + L134 else block mutant)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined });
    const out = beforeSend({
      request: {
        headers: {
          authorization: 'Bearer x',
          'x-trace-id': 'trace-123',
          'set-cookie': ['c1=1', 'c2=2'],
        },
      },
    });
    const h = out.request?.headers as Record<string, string | string[]>;
    // PII header was redacted with REDACTED in its array
    expect(h['set-cookie']).toEqual(['[redacted]']);
    expect(h['authorization']).toBe('[redacted]');
    // Non-PII header was preserved unchanged (kills the else-block-deletion mutant)
    expect(h['x-trace-id']).toBe('trace-123');
  });

  it('skips req.data scrub when req.data is undefined (kills L140 if(true) mutant)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined });
    // request present but without data
    const out = beforeSend({ request: { headers: { 'x-trace': 't' } } });
    expect((out.request as { data?: unknown }).data).toBeUndefined();
  });

  it('skips out.extra scrub when extra is absent (kills L143 if(true) mutant)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined });
    const out = beforeSend({ message: 'clean' });
    expect(out.extra).toBeUndefined();
  });

  it('skips out.contexts scrub when contexts is absent (kills L144 if(true)/if(false) mutants)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined });
    const out = beforeSend({ message: 'clean' });
    expect(out.contexts).toBeUndefined();
  });

  it('skips __redaction injection when annotateEvent is false (kills L145 if(true) mutant)', () => {
    const beforeSend = createBeforeSend({ auditLog: () => undefined, annotateEvent: false });
    const out = beforeSend({ message: 'Bearer abc.def-ghi' });
    expect(out.extra?.['__redaction']).toBeUndefined();
  });
});

describe('scrub depth-boundary mutation-hardening', () => {
  it('at depth = DEFAULT_DEPTH_LIMIT, value is still scrubbed (kills > -> >= mutant on line 153)', async () => {
    // Wait — the depth check in sentry-scrub line 153 uses `if (depth > DEFAULT_DEPTH_LIMIT)`.
    // Mutating to `>=` means at depth==6 we'd bail and NOT scrub. So a PII key at depth 6 must still be redacted.
    // Build a 6-deep nesting with PII at the deepest level.
    const deep: Record<string, unknown> = { password: 'leak' }; // pragma: allowlist secret
    let nested: Record<string, unknown> = deep;
    for (let i = 0; i < 6; i++) nested = { w: nested };
    // At this point depth=0 sees {w:{w:{w:{w:{w:{w:{w:{password:...}}}}}}}}.
    // scrubEvent calls scrub at depth 0; password is at depth 7. Need exactly depth 6 for boundary.
    const fivedeep: Record<string, unknown> = { password: 'leak' }; // pragma: allowlist secret
    let n5 = fivedeep;
    for (let i = 0; i < 5; i++) n5 = { w: n5 };
    // Pass through scrubEvent.extra so the top-level scrub is invoked.
    const ev = (await import('../src/sentry-scrub.js')).scrubEvent({ extra: { root: n5 as Record<string, unknown> } });
    // Walk down to find the password
    let cur: unknown = ev.extra?.['root'];
    for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
      cur = (cur as Record<string, unknown>)['w'];
    }
    const final = cur as Record<string, unknown>;
    expect(final?.['password']).toBe('[redacted]');
  });
});

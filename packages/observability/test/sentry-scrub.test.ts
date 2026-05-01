// packages/observability/test/sentry-scrub.test.ts
import { describe, it, expect } from 'vitest';
import {
  scrub,
  scrubString,
  scrubEvent,
  createScrubber,
  setScrubErrorHandler,
  PII_KEY_RE,
  PII_HEADERS,
  REDACTED,
  UNSCRUBBABLE,
  type ScrubbableEvent,
} from '../src/index.js';

describe('scrubString', () => {
  it('redacts Bearer tokens', () => {
    expect(scrubString('Bearer abc.def-ghi')).toBe(REDACTED);
  });
  it('redacts JWTs', () => {
    expect(scrubString('eyJhbGc.eyJzdWI.SflKxw')).toBe(REDACTED);
  });
  it('redacts emails', () => {
    expect(scrubString('contact me at jane.doe@example.com please')).toBe(
      'contact me at [redacted] please',
    );
  });
  it('redacts phone numbers', () => {
    expect(scrubString('call +1 (415) 555-0123 now')).toBe('call [redacted] now');
  });
  it('passes through clean strings unchanged', () => {
    expect(scrubString('hello world')).toBe('hello world');
  });
});

describe('PII_KEY_RE', () => {
  it.each([
    'password',
    'authToken',
    'api_secret',
    'Authorization',
    'apiKey',
    'cookie',
    'push_token',
    'gps',
    'latitude',
    'longitude',
    'phone',
    'email',
    'ssn',
    'driver_name',
  ])('matches %s', (k) => {
    expect(PII_KEY_RE.test(k)).toBe(true);
  });
  it.each(['username', 'orderId', 'truckNumber'])('does not match %s', (k) => {
    expect(PII_KEY_RE.test(k)).toBe(false);
  });
});

describe('scrub (purity + structure)', () => {
  it('returns primitives unchanged', () => {
    expect(scrub(42)).toBe(42);
    expect(scrub(true)).toBe(true);
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
  });

  it('does not mutate input objects', () => {
    const input = { password: 'p', nested: { email: 'a@b.co' } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
    scrub(input);
    expect(input).toEqual(snapshot);
  });

  it('redacts keys matching PII_KEY_RE', () => {
    const out = scrub({ password: 'secret', user: 'alice' }) as Record<string, unknown>;
    expect(out['password']).toBe(REDACTED);
    expect(out['user']).toBe('alice');
  });

  it('recursively redacts nested values', () => {
    const out = scrub({ a: { b: 'jane@x.com' } }) as Record<string, Record<string, unknown>>;
    expect(out['a']?.['b']).toBe(REDACTED);
  });

  it('handles arrays', () => {
    const out = scrub(['hello', 'a@b.co']) as string[];
    expect(out[0]).toBe('hello');
    expect(out[1]).toBe(REDACTED);
  });

  it('caps recursion depth to prevent stack overflow', () => {
    interface Node { next?: Node }
    const root: Node = {};
    let cur: Node = root;
    for (let i = 0; i < 20; i++) {
      cur.next = {};
      cur = cur.next;
    }
    expect(() => { scrub(root); }).not.toThrow();
  });

  it('returns UNSCRUBBABLE sentinel when Object.entries throws', () => {
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('no peeking');
        },
      },
    );
    expect(scrub(trap)).toBe(UNSCRUBBABLE);
  });
});

describe('scrubEvent (purity)', () => {
  it('does not mutate the input event', () => {
    const input: ScrubbableEvent = {
      message: 'token Bearer abc.def-ghi here',
      request: {
        headers: { authorization: 'Bearer x', 'x-trace': 't' },
        data: { password: 'p' },
      },
      extra: { email: 'a@b.co' },
      contexts: { os: { name: 'linux' } },
      exception: { values: [{ value: 'err with a@b.co' }] },
    };
    const snapshot: typeof input = JSON.parse(JSON.stringify(input));
    scrubEvent(input);
    expect(input).toEqual(snapshot);
  });

  it('redacts message', () => {
    const out = scrubEvent({ message: 'Bearer abc.def-ghi' });
    expect(out.message).toBe(REDACTED);
  });

  it('redacts exception values', () => {
    const input: ScrubbableEvent = {
      exception: { values: [{ value: 'oops a@b.co' }, { value: 'fine' }] },
    };
    const out = scrubEvent(input);
    const vals = out.exception?.values ?? [];
    expect(vals[0]?.value).toBe('oops [redacted]');
    expect(vals[1]?.value).toBe('fine');
  });

  it('redacts PII headers, preserves others, handles array values', () => {
    const input: ScrubbableEvent = {
      request: {
        headers: {
          authorization: 'Bearer x',
          'set-cookie': ['a=1', 'b=2'],
          'x-trace': 't',
        },
      },
    };
    const out = scrubEvent(input);
    const headers = out.request?.headers ?? {};
    expect(headers['authorization']).toBe(REDACTED);
    expect(headers['set-cookie']).toEqual([REDACTED]);
    expect(headers['x-trace']).toBe('t');
  });

  it('matches PII headers case-insensitively', () => {
    const input: ScrubbableEvent = {
      request: { headers: { 'X-API-Key': 'k', 'Set-Cookie': 'c=1' } },
    };
    const out = scrubEvent(input);
    const headers = out.request?.headers ?? {};
    expect(headers['X-API-Key']).toBe(REDACTED);
    expect(headers['Set-Cookie']).toBe(REDACTED);
  });

  it('scrubs request.data, extra, contexts', () => {
    const input: ScrubbableEvent = {
      request: { data: { password: 'p' } },
      extra: { token: 't' },
      contexts: { auth: { secret: 's' } },
    };
    const out = scrubEvent(input);
    const data = out.request?.data as Record<string, unknown>;
    expect(data['password']).toBe(REDACTED);
    expect(out.extra?.['token']).toBe(REDACTED);
    const auth = out.contexts?.['auth'] as Record<string, unknown>;
    expect(auth['secret']).toBe(REDACTED);
  });

  it('handles empty event', () => {
    expect(scrubEvent({})).toEqual({});
  });

  it('PII_HEADERS contains expected keys', () => {
    expect(PII_HEADERS.has('authorization')).toBe(true);
    expect(PII_HEADERS.has('cookie')).toBe(true);
    expect(PII_HEADERS.has('set-cookie')).toBe(true);
    expect(PII_HEADERS.has('x-api-key')).toBe(true);
  });
});

describe('createScrubber', () => {
  it('uses default depthLimit of 6', () => {
    const fn = createScrubber();
    expect(fn('hello')).toBe('hello');
  });

  it('respects custom depthLimit (shallow stops recursion)', () => {
    const fn = createScrubber({ depthLimit: 0 });
    const out = fn({ a: { password: 'p' } }) as Record<string, unknown>;
    expect(out['a']).toEqual({ password: 'p' });
  });

  it('respects custom depthLimit (deep)', () => {
    const fn = createScrubber({ depthLimit: 10 });
    type Nest = Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    const out = fn({ a: { b: { c: { password: 'p' } } } }) as Nest;
    expect(out['a']?.['b']?.['c']?.['password']).toBe(REDACTED);
  });

  it('redacts PII keys', () => {
    const fn = createScrubber();
    const out = fn({ password: 'secret', user: 'alice' }) as Record<string, unknown>;
    expect(out['password']).toBe(REDACTED);
    expect(out['user']).toBe('alice');
  });

  it('redacts strings via PII_VALUE_PATTERNS', () => {
    const fn = createScrubber();
    expect(fn('Bearer abc.def-ghi')).toBe(REDACTED);
  });

  it('handles arrays', () => {
    const fn = createScrubber();
    const out = fn(['a@b.co', 'fine']) as string[];
    expect(out[0]).toBe(REDACTED);
    expect(out[1]).toBe('fine');
  });

  it('returns UNSCRUBBABLE on throwing object', () => {
    const fn = createScrubber();
    const trap = new Proxy({}, { ownKeys() { throw new Error('nope'); } });
    expect(fn(trap)).toBe(UNSCRUBBABLE);
  });

  it('calls onScrubError when scrub catches', () => {
    const errors: unknown[] = [];
    const fn = createScrubber({ onScrubError: (e) => errors.push(e) });
    const trap = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
    expect(fn(trap)).toBe(UNSCRUBBABLE);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');
  });

  it('passes through primitives', () => {
    const fn = createScrubber();
    expect(fn(null)).toBe(null);
    expect(fn(undefined)).toBe(undefined);
    expect(fn(42)).toBe(42);
    expect(fn(true)).toBe(true);
  });
});

describe('scrub error observability (top-level)', () => {
  it('exposes setScrubErrorHandler that receives errors from default scrub()', () => {
    const errors: unknown[] = [];
    setScrubErrorHandler((err) => errors.push(err));
    try {
      const trap = new Proxy({}, { ownKeys() { throw new Error('boom-default'); } });
      expect(scrub(trap)).toBe(UNSCRUBBABLE);
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('boom-default');
    } finally {
      setScrubErrorHandler(undefined);
    }
  });

  it('default scrub() works with no handler set', () => {
    setScrubErrorHandler(undefined);
    const trap = new Proxy({}, { ownKeys() { throw new Error('silent'); } });
    expect(scrub(trap)).toBe(UNSCRUBBABLE);
  });
});


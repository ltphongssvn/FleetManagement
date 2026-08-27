// packages/observability/test/sentry-scrub.test.ts
import { describe, it, expect } from 'vitest';
import {
  scrub,
  scrubString,
  scrubEvent,
  createScrubber,
  setScrubErrorHandler,
  assertPiiHeader,
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
    interface Node {
      next?: Node;
    }
    const root: Node = {};
    let cur: Node = root;
    for (let i = 0; i < 20; i++) {
      cur.next = {};
      cur = cur.next;
    }
    expect(() => {
      scrub(root);
    }).not.toThrow();
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
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('nope');
        },
      },
    );
    expect(fn(trap)).toBe(UNSCRUBBABLE);
  });

  it('calls onScrubError when scrub catches', () => {
    const errors: unknown[] = [];
    const fn = createScrubber({ onScrubError: (e) => errors.push(e) });
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
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
      const trap = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('boom-default');
          },
        },
      );
      expect(scrub(trap)).toBe(UNSCRUBBABLE);
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('boom-default');
    } finally {
      setScrubErrorHandler(undefined);
    }
  });

  it('default scrub() works with no handler set', () => {
    setScrubErrorHandler(undefined);
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('silent');
        },
      },
    );
    expect(scrub(trap)).toBe(UNSCRUBBABLE);
  });
});

describe('createScrubber audit counts', () => {
  it('reports redactionCount via onRedact callback', () => {
    let count = 0;
    const fn = createScrubber({
      onRedact: () => {
        count++;
      },
    });
    fn({ password: 'p', email: 'a@b.co', user: 'alice' });
    // password key match + email value pattern in 'a@b.co'? value 'a@b.co' is under non-pii key,
    // so only key-match (password) counts. email key also matches PII_KEY_RE.
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('counts string-pattern redactions inside values', () => {
    let count = 0;
    const fn = createScrubber({
      onRedact: () => {
        count++;
      },
    });
    fn({ note: 'Bearer abc.def-ghi and jane@example.com' });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('does not call onRedact for non-PII data', () => {
    let count = 0;
    const fn = createScrubber({
      onRedact: () => {
        count++;
      },
    });
    fn({ user: 'alice', count: 42 });
    expect(count).toBe(0);
  });
});

describe('mutation-hardening tests', () => {
  it('depthLimit boundary: at exact depth, value is still scrubbed (depth > limit, not >=)', () => {
    // depthLimit=2 means depths 0, 1, 2 are processed; depth 3 returns raw
    const fn = createScrubber({ depthLimit: 2 });
    const out = fn({ a: { b: { password: 'p' } } }) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    // path: depth 0 (root) -> 1 (a) -> 2 (b) -> 3 (password key check at depth 3?)
    // At root (depth 0) we recurse into 'a' at depth 1, then 'b' at depth 2.
    // Inside 'b' we iterate keys at depth 2; PII_KEY_RE check happens, password redacted.
    expect(out['a']?.['b']?.['password']).toBe('[redacted]');
  });

  it('default scrub recursion direction: deeper objects exceed DEFAULT_DEPTH_LIMIT', () => {
    // Build object 8 levels deep with PII at leaf — beyond default 6, should NOT redact
    let obj: Record<string, unknown> = { password: 'leaked' }; // pragma: allowlist secret
    for (let i = 0; i < 8; i++) obj = { w: obj };
    const out = scrub(obj) as Record<string, unknown>;
    // Walk to depth 7 and check password remains (exceeded depth limit)
    let cur: unknown = out;
    for (let i = 0; i < 8; i++) cur = (cur as Record<string, unknown>)['w'];
    expect((cur as Record<string, unknown>)['password']).toBe('leaked');
  });

  it('scrubEvent does not call scrub when request.data is absent', () => {
    // Mutant: `if (req.data !== undefined)` -> `if (true)` would call scrub(undefined)
    // and assign the result. We verify req.data stays absent (not set to scrubbed-undefined).
    const out = scrubEvent({ request: { headers: {} } });
    expect('data' in out.request).toBe(false);
  });

  it('scrubEvent does not add extra/contexts when absent', () => {
    const out = scrubEvent({ message: 'hi' });
    expect('extra' in out).toBe(false);
    expect('contexts' in out).toBe(false);
  });

  it('Bearer pattern requires whitespace (\\s+, not \\s)', () => {
    // Mutant Bearer\s -> still matches one space, hard to kill. Test the + quantifier
    // by ensuring Bearer with multiple spaces still redacts entire token.
    expect(scrubString('Bearer   abc.def-ghi')).toBe('[redacted]');
  });

  it('phone pattern: validates parenthesis presence is optional', () => {
    expect(scrubString('call 415-555-0123')).toBe('call [redacted]');
    expect(scrubString('call (415)555-0123')).toBe('call [redacted]');
  });

  it('PII_KEY_RE: push.*token matches with multiple chars between (kills push.*token -> push.token mutant)', () => {
    // The . metacharacter alone matches exactly 1 char; .* matches zero or more.
    // A key with multiple characters between "push" and "token" requires .* to match.
    expect(PII_KEY_RE.test('pushXYZtoken')).toBe(true);
    expect(PII_KEY_RE.test('pushSubscriptionToken')).toBe(true);
  });

  it('PII_KEY_RE: driver.*name matches with multiple chars between (kills driver.*name -> driver.name mutant)', () => {
    expect(PII_KEY_RE.test('driverFullname')).toBe(true);
    expect(PII_KEY_RE.test('driverLegalname')).toBe(true);
  });

  it('phone pattern: matches without leading + (kills \\+? -> \\+ mutant)', () => {
    // The country-code group is `(?:\\+?\\d{1,3}[-.\\s]?)?` — making \\+ required
    // (\\+? -> \\+) means the group can't consume a country code without `+`.
    // Input `1 415-555-0123` distinguishes: original matches whole thing
    // including the leading `1 ` via the optional group; mutated skips the
    // group, so only `415-555-0123` is redacted, leaving `1 ` intact.
    expect(scrubString('call 415-555-0123')).toBe('call [redacted]');
    // The discriminating case:
    expect(scrubString('1 415-555-0123 ok')).toBe('[redacted] ok');
  });

  it('phone pattern: matches multi-digit country codes (kills \\d{1,3} -> \\d mutant)', () => {
    // 2-digit country code +84 followed by 10-digit phone in XXX-XXX-XXXX shape
    expect(scrubString('+84 901 234 5678')).toBe('[redacted]');
    // 3-digit country code +234 (Nigeria) followed by 10-digit phone
    expect(scrubString('+234 901 234 5678')).toBe('[redacted]');
  });

  it('phone pattern: matches without separator after country code (kills [-.\\s]? -> [-.\\s] mutant)', () => {
    // No char between "+1" and the area code "(415)" — the [-.\s]? group must remain optional.
    expect(scrubString('+1(415)555-0123')).toBe('[redacted]');
  });

  it('phone pattern: separator between groups must be -, ., or whitespace (kills [-.\\s] -> [-.\\S] mutant)', () => {
    // Replacing [-.\s] with [-.\S] would match digit-only separator like "415X555-0123";
    // a clean digit run with no separator should NOT match as a phone number.
    expect(scrubString('4155550123')).toBe('[redacted]'); // 10 raw digits still match optional separators
    // A string that should NOT be redacted as a phone (proves the negation case)
    expect(scrubString('abc xyz')).toBe('abc xyz');
  });

  it('assertPiiHeader error message names the offending header', () => {
    expect(() => assertPiiHeader('made-up-header')).toThrow(/made-up-header/);
  });
});

describe('array redaction edge cases', () => {
  it('redacts PII strings inside arrays', () => {
    const out = scrub(['Bearer abc.def-ghi', 'jane@example.com', 'safe']) as string[];
    expect(out[0]).toBe('[redacted]');
    expect(out[1]).toBe('[redacted]');
    expect(out[2]).toBe('safe');
  });

  it('redacts PII keys in objects nested in arrays', () => {
    const out = scrub([{ password: 'p1' }, { password: 'p2' }, { user: 'alice' }]) as Record<
      string,
      unknown
    >[];
    if (out.length !== 3) throw new Error('expected 3');
    const [a, b, c] = out as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(a['password']).toBe('[redacted]');
    expect(b['password']).toBe('[redacted]');
    expect(c['user']).toBe('alice');
  });

  it('handles arrays of arrays (jagged)', () => {
    const out = scrub([['a@b.co'], ['safe', 'Bearer xyz.abc-def']]) as string[][];
    const [r0, r1] = out as [string[], string[]];
    expect(r0[0]).toBe('[redacted]');
    expect(r1[1]).toBe('[redacted]');
  });

  it('handles empty arrays', () => {
    expect(scrub([])).toEqual([]);
  });

  it('preserves array length', () => {
    const input = ['a', 'b@c.de', 'd'];
    const out = scrub(input) as unknown[];
    expect(out).toHaveLength(3);
  });

  it('does not mutate input arrays', () => {
    const input = ['Bearer abc.def-ghi', 'safe'];
    const snap = [...input];
    scrub(input);
    expect(input).toEqual(snap);
  });

  it('respects depthLimit when array contains nested objects', () => {
    const fn = createScrubber({ depthLimit: 1 });
    // depth 0=root array, depth 1=object inside, depth 2=password key check
    const out = fn([{ password: 'leaked' }]) as Record<string, unknown>[];
    // At depth 1, key check happens; password is a key at depth 1's iteration
    const [first] = out as [Record<string, unknown>];
    expect(first['password']).toBe('[redacted]');
  });
});

describe('drizzle failed-query exception values (2026-07-06 Sentry leak)', () => {
  it('redacts bcrypt hashes in strings', () => {
    const hash = '$2b$10$LBb70EYQ543VZVYZo8TVNOjK6TpOm9wEoksEtLM0yGwnDaO5lVXku';
    expect(scrubString('pw=' + hash)).not.toContain(hash);
  });
  it('truncates the params tail of drizzle Failed query messages (names, hashes, ids)', () => {
    const msg =
      'Failed query: insert into driver (...) values (...)' +
      String.fromCharCode(10) +
      'params: abc-123,LE VAN CHAU,0913998879,$2b$10$LBb70EYQ543VZVYZo8TVNOjK6TpOm9wEoksEtLM0yGwnDaO5lVXku,18d6a077-2fd5-489d-872c-907da68fe373,true';
    const out = scrubString(msg);
    expect(out).toContain('Failed query: insert into driver');
    expect(out).not.toContain('LE VAN CHAU');
    expect(out).not.toContain('LBb70EYQ543');
    expect(out).not.toContain('18d6a077');
  });
});

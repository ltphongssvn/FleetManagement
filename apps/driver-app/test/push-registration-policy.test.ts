// apps/driver-app/test/push-registration-policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  decidePushRegistration,
  isValidExpoPushToken,
  PUSH_REGISTRATION_POLICY_VERSION,
  PUSH_TOKEN_TTL_MS,
  type PushTokenInput,
  type RegisteredPushToken,
} from '../src/push/push-registration-policy.js';

const VALID_TOKEN = 'ExponentPushToken[xxx-yyy-zzz_aBc123]';
const VALID_TOKEN_SHORT = 'ExpoPushToken[abc123]';

const baseInput: PushTokenInput = {
  token: VALID_TOKEN,
  permissionGranted: true,
  nowMs: 1_700_000_000_000,
};

describe('@fleet/driver-app - isValidExpoPushToken', () => {
  it('accepts ExponentPushToken format', () => {
    expect(isValidExpoPushToken(VALID_TOKEN)).toBe(true);
  });
  it('accepts ExpoPushToken format', () => {
    expect(isValidExpoPushToken(VALID_TOKEN_SHORT)).toBe(true);
  });
  it('rejects empty', () => {
    expect(isValidExpoPushToken('')).toBe(false);
  });
  it('rejects FCM token', () => {
    expect(isValidExpoPushToken('fGq8...some-fcm-token')).toBe(false);
  });
  it('rejects malformed (missing bracket)', () => {
    expect(isValidExpoPushToken('ExponentPushTokenabc123')).toBe(false);
  });
  it('rejects gibberish', () => {
    expect(isValidExpoPushToken('not-a-token')).toBe(false);
  });
});

describe('@fleet/driver-app - decidePushRegistration', () => {
  it('rejects with permission_denied when no previous token and permission not granted', () => {
    const r = decidePushRegistration({ ...baseInput, permissionGranted: false }, null);
    expect(r.action).toBe('reject');
    if (r.action === 'reject') expect(r.rejectionCode).toBe('permission_denied');
  });

  it('returns deregister when permission revoked but previous token exists (#404)', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN, registeredAtMs: baseInput.nowMs - 1000 };
    const r = decidePushRegistration({ ...baseInput, permissionGranted: false }, previous);
    expect(r.action).toBe('deregister');
    if (r.action === 'deregister') {
      expect(r.previousToken).toBe(VALID_TOKEN);
      expect(r.reason).toBe('permission_revoked');
    }
  });

  it('trims surrounding whitespace from token and validates the cleaned value (#400)', () => {
    const r = decidePushRegistration({ ...baseInput, token: `  ${VALID_TOKEN}  ` }, null);
    expect(r.action).toBe('register');
    if (r.action === 'register') expect(r.token).toBe(VALID_TOKEN);
  });

  it('skips re-register when previous token matches the trimmed value (#400)', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN, registeredAtMs: baseInput.nowMs - 60_000 };
    const r = decidePushRegistration({ ...baseInput, token: `  ${VALID_TOKEN}  ` }, previous);
    expect(r.action).toBe('skip');
  });

  it('rejects empty token', () => {
    const r = decidePushRegistration({ ...baseInput, token: '   ' }, null);
    expect(r.action).toBe('reject');
    if (r.action === 'reject') expect(r.rejectionCode).toBe('token_empty');
  });

  it('rejects invalid format', () => {
    const r = decidePushRegistration({ ...baseInput, token: 'not-expo' }, null);
    expect(r.action).toBe('reject');
    if (r.action === 'reject') expect(r.rejectionCode).toBe('invalid_format');
  });

  it('registers when no previous token', () => {
    const r = decidePushRegistration(baseInput, null);
    expect(r.action).toBe('register');
    if (r.action === 'register') {
      expect(r.token).toBe(VALID_TOKEN);
      expect(r.policyVersion).toBe(PUSH_REGISTRATION_POLICY_VERSION);
    }
  });

  it('registers when token has rotated (different from previous)', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN_SHORT, registeredAtMs: baseInput.nowMs - 1000 };
    const r = decidePushRegistration(baseInput, previous);
    expect(r.action).toBe('register');
  });

  it('skips when same token and within TTL', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN, registeredAtMs: baseInput.nowMs - 60_000 };
    const r = decidePushRegistration(baseInput, previous);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('token_fresh');
  });

  it('re-registers when same token but past TTL (rotation refresh)', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN, registeredAtMs: baseInput.nowMs - PUSH_TOKEN_TTL_MS - 1 };
    const r = decidePushRegistration(baseInput, previous);
    expect(r.action).toBe('register');
  });


  it('re-registers at exact TTL boundary (#433)', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN, registeredAtMs: baseInput.nowMs - PUSH_TOKEN_TTL_MS };
    const r = decidePushRegistration(baseInput, previous);
    expect(r.action).toBe('register');
  });
  it('skips at exact TTL minus 1ms boundary', () => {
    const previous: RegisteredPushToken = { token: VALID_TOKEN, registeredAtMs: baseInput.nowMs - PUSH_TOKEN_TTL_MS + 1 };
    const r = decidePushRegistration(baseInput, previous);
    expect(r.action).toBe('skip');
  });

  it('every decision carries policyVersion', () => {
    expect(decidePushRegistration(baseInput, null).policyVersion).toBe(PUSH_REGISTRATION_POLICY_VERSION);
    expect(decidePushRegistration({ ...baseInput, permissionGranted: false }, null).policyVersion).toBe(PUSH_REGISTRATION_POLICY_VERSION);
  });
});

describe('@fleet/driver-app - push-registration-policy stable identifiers', () => {
  it('exports policy version + TTL', () => {
    expect(PUSH_REGISTRATION_POLICY_VERSION).toBe('push-registration-v1');
    expect(PUSH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

import fc from 'fast-check';

describe('@fleet/driver-app - push-registration-policy property invariants', () => {
  it('decidePushRegistration never throws on arbitrary inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          token: fc.string(),
          permissionGranted: fc.boolean(),
          nowMs: fc.integer({ min: 0, max: 10_000_000_000_000 }),
        }),
        fc.option(fc.record({
          token: fc.string({ minLength: 1, maxLength: 100 }),
          registeredAtMs: fc.integer({ min: 0, max: 10_000_000_000_000 }),
        })),
        (input, previous) => {
          const r = decidePushRegistration(input, previous);
          expect(['register', 'skip', 'deregister', 'reject']).toContain(r.action);
          expect(r.policyVersion).toBe(PUSH_REGISTRATION_POLICY_VERSION);
          return true;
        },
      ),
    );
  });

  it('isValidExpoPushToken never throws and returns boolean for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = isValidExpoPushToken(s);
        expect(typeof r).toBe('boolean');
        return true;
      }),
    );
  });

  it('permission denied + no previous always rejects with permission_denied', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: 10_000_000_000_000 }),
        (token, nowMs) => {
          const r = decidePushRegistration({ token, permissionGranted: false, nowMs }, null);
          expect(r.action).toBe('reject');
          if (r.action === 'reject') expect(r.rejectionCode).toBe('permission_denied');
          return true;
        },
      ),
    );
  });

  it('valid token + no previous always registers with trimmed token', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).map((s) => `ExponentPushToken[${s.replace(/[^A-Za-z0-9_-]/g, 'a')}]`),
        fc.integer({ min: 0, max: 10_000_000_000_000 }),
        (token, nowMs) => {
          const r = decidePushRegistration({ token, permissionGranted: true, nowMs }, null);
          expect(r.action).toBe('register');
          if (r.action === 'register') expect(r.token).toBe(token);
          return true;
        },
      ),
    );
  });
});

describe('@fleet/driver-app - push-registration-policy mutation-hardening', () => {
  it('isValidExpoPushToken rejects token with leading junk (kills L39 regex /^Ex.../ -> /Ex.../ mutant)', () => {
    // Original anchors at start with ^Ex. 'JUNKExponentPushToken[abc]' starts with J → reject.
    // Mutated /Ex.../ (no ^): matches substring 'ExponentPushToken[abc]' → accept. DIFFERENT.
    expect(isValidExpoPushToken('JUNKExponentPushToken[abc123]')).toBe(false);
  });

  it('isValidExpoPushToken rejects token with trailing junk (kills L39 regex /...$/ -> /.../ mutant)', () => {
    // Original anchors at end with \]$. 'ExpoPushToken[abc]junk' ends with k → reject.
    // Mutated /...\]/ (no $): matches prefix 'ExpoPushToken[abc]' → accept. DIFFERENT.
    expect(isValidExpoPushToken('ExpoPushToken[abc123]junk')).toBe(false);
  });
});

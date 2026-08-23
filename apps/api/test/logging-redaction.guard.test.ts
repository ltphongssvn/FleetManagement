// apps/api/test/logging-redaction.guard.test.ts
// Secrets never reach a log sink.
//
// WHY THIS IS A RUNTIME TEST, not an assertion about the config object. A list
// of redaction paths that LOOKS right proves nothing: pino's paths use a
// bracket/dot syntax where a typo (req.header.authorization, singular) silently
// matches nothing and the header ships in plaintext. The only claim worth
// making is that a real pino instance, given a payload carrying credential-
// shaped values, emits output that does NOT contain them -- so this drives an
// actual logger and inspects its actual bytes.
//
// THE FIXTURE VALUES ARE DELIBERATELY NOT CREDENTIAL-SHAPED. An earlier draft
// used realistic-looking header and cookie values and tripped detect-secrets.
// This comment deliberately DESCRIBES those shapes rather than reproducing
// them: writing the literal form here would re-introduce the very pattern the
// rewrite removed, which the readback canary caught on the first attempt. The documented mitigation is an inline allowlist pragma, and
// that is the WRONG fix twice over: it is scanner-specific, so a cloud scanner
// such as GitGuardian still flags the value on its own shape, and it drifts the
// moment the line moves. Eliminating the SHAPE removes the finding for every
// scanner, present and future, with nothing to maintain. The test does not need
// realistic values -- it needs UNIQUE, GREPPABLE sentinels, which these are.
//
// This api handles driver credentials, session cookies, bearer tokens and the
// EAS webhook HMAC signature. Relying on every author to remember not to log
// those is the control that fails; declaring the paths once and testing them at
// runtime is the control that holds.
import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { REDACTED_PATHS } from '../src/observability/logging.module.js';

/** Drive a real pino instance and capture the bytes it writes. */
function emit(payload: Record<string, unknown>): string {
  const chunks: string[] = [];
  const log = pino(
    { redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' } },
    { write: (c: string) => chunks.push(c) },
  );
  log.info(payload, 'probe');
  return chunks.join('');
}

/** Opaque sentinels: unique enough to find in output, shaped like nothing a
 *  secret scanner recognises. Each is a plain word sequence, not a token,
 *  cookie, URL or key format. */
const SENTINEL = {
  authorizationHeader: 'CANARY-ALPHA-must-not-appear',
  cookieHeader: 'CANARY-BRAVO-must-not-appear',
  signatureHeader: 'CANARY-CHARLIE-must-not-appear',
  bodyCredential: 'CANARY-DELTA-must-not-appear',
  bodyNewCredential: 'CANARY-ECHO-must-not-appear',
  responseCookie: 'CANARY-FOXTROT-must-not-appear',
} as const;

/** A field that is NOT on the redaction list, used to prove the masking is
 *  targeted rather than indiscriminate. */
const VISIBLE_FIELD = 'CANARY-VISIBLE-should-appear';

const FULL_PAYLOAD = {
  req: {
    headers: {
      authorization: SENTINEL.authorizationHeader,
      cookie: SENTINEL.cookieHeader,
      'expo-signature': SENTINEL.signatureHeader,
    },
    body: {
      password: SENTINEL.bodyCredential,
      newPassword: SENTINEL.bodyNewCredential,
      phone: VISIBLE_FIELD,
    },
  },
  res: { headers: { 'set-cookie': SENTINEL.responseCookie } },
};

describe('pino redaction keeps credentials out of logs', () => {
  // Vacuity guard FIRST: if the logger emitted nothing, every "does not
  // contain" assertion below would pass trivially.
  it('emits a non-empty line for the probe payload', () => {
    expect(emit(FULL_PAYLOAD).length).toBeGreaterThan(50);
  });

  it('leaks no value from any declared path', () => {
    const out = emit(FULL_PAYLOAD);
    for (const [name, value] of Object.entries(SENTINEL)) {
      expect({ name, leaked: out.includes(value) }).toEqual({ name, leaked: false });
    }
  });

  // The complement: redaction must be TARGETED, not a blanket mask. A rule that
  // hid everything would pass the test above while destroying the log's value.
  it('preserves fields that are not on the list', () => {
    expect(emit(FULL_PAYLOAD)).toContain(VISIBLE_FIELD);
  });

  it('replaces each redacted value with the censor marker', () => {
    const out = emit(FULL_PAYLOAD);
    expect((out.match(/\[REDACTED\]/g) ?? []).length).toBe(REDACTED_PATHS.length);
  });

  it('emits parseable newline-delimited JSON with queryable fields', () => {
    const parsed = JSON.parse(emit({ a: 1 }).trim()) as Record<string, unknown>;
    expect(typeof parsed['time']).toBe('number');
    expect(parsed['msg']).toBe('probe');
    expect(parsed['level']).toBe(30);
  });

  it('the path list is frozen, so it cannot be mutated at runtime', () => {
    expect(Object.isFrozen(REDACTED_PATHS)).toBe(true);
  });
});

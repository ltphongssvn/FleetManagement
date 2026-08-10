// scripts/env-bootstrap-errors.test.ts
// Contract for how the env-bootstrap CLI REPORTS failure.
//
// ROOT CAUSE THIS CLOSES, observed 2026-08-09 on the first live run of
// //#env:recipients: an empty .age-recipients made parseRecipients throw, and
// the CLI let the raw ZodError escape. What reached the operator was a stack
// trace with absolute paths, node internals, and the tsx transformer frame --
// forty lines in which the one actionable sentence ("refusing to encrypt to an
// empty recipient list") was buried. Every OTHER refusal path in this CLI is
// carefully humane (describeRefusal names a condition and a remedy), so an
// unhandled throw is not merely ugly: it is an inconsistency that teaches the
// operator the tool is unreliable, and it is the shape that makes people stop
// reading output. The fix is at the source -- one boundary that converts any
// thrown error into the same one-line, secret-free diagnostic every refusal
// already uses -- not a try/catch bolted onto the single call site that failed.
//
// A stack trace is also a LEAK SURFACE: node prints the offending source line,
// and for a parse failure over secret material that line can carry a value.
// Formatting errors ourselves is what guarantees the value never appears.
import { describe, it, expect } from 'vitest';
import { formatCliError } from './env-bootstrap-cli.js';

describe('formatCliError', () => {
  it('extracts the zod message rather than dumping the raw issue array', () => {
    const zodShaped = Object.assign(new Error('bad'), {
      name: 'ZodError',
      issues: [{ path: [], message: 'refusing to encrypt to an empty recipient list' }],
    });
    const out = formatCliError(zodShaped);
    expect(out).toContain('refusing to encrypt to an empty recipient list');
    expect(out).not.toContain('issues');
    expect(out).not.toContain('[');
  });

  it('joins multiple zod issues on one line each, no JSON punctuation', () => {
    const zodShaped = Object.assign(new Error('bad'), {
      name: 'ZodError',
      issues: [
        { path: [], message: 'first problem' },
        { path: [], message: 'second problem' },
      ],
    });
    const out = formatCliError(zodShaped);
    expect(out).toContain('first problem');
    expect(out).toContain('second problem');
    expect(out).not.toContain('{');
  });

  it('uses the message of an ordinary Error', () => {
    expect(formatCliError(new Error('plain failure'))).toContain('plain failure');
  });

  it('never emits a stack trace', () => {
    const e = new Error('boom');
    expect(formatCliError(e)).not.toContain('at ');
    expect(formatCliError(e)).not.toContain('node:internal');
  });

  it('never emits an absolute filesystem path', () => {
    const e = new Error('failed at /Users/someone/secret/path/file.ts');
    expect(formatCliError(e)).not.toContain('/Users/');
  });

  it('redacts anything shaped like an age private key', () => {
    const e = new Error('bad key AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQ rejected');
    const out = formatCliError(e);
    expect(out).not.toContain('AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQ');
    expect(out).toContain('REDACTED');
  });

  it('handles a non-Error throw without crashing', () => {
    expect(formatCliError('a bare string')).toContain('a bare string');
    expect(formatCliError(undefined).length).toBeGreaterThan(0);
  });

  it('always returns a single line -- no embedded newlines', () => {
    const e = new Error('line one' + String.fromCharCode(10) + 'line two');
    expect(formatCliError(e)).not.toContain(String.fromCharCode(10));
  });
});

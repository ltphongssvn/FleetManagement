// apps/api/test/commands-gateway-extract-token.test.ts
// Unit tests for extractToken — kills StringLiteral, ConditionalExpression,
// LogicalOperator, EqualityOperator, MethodExpression mutants on lines 43-45.
import { describe, it, expect } from 'vitest';
import { extractToken } from '../src/commands/commands.gateway.js';

describe('@fleet/api - extractToken', () => {
  it('returns handshake.auth.token when it is a non-empty string (kills typeof/length mutants)', () => {
    const result = extractToken({ auth: { token: 'jwt-xyz' }, headers: {} });
    expect(result).toBe('jwt-xyz');
  });

  it('returns undefined when handshake.auth.token is empty string (kills length > 0 boundary)', () => {
    const result = extractToken({ auth: { token: '' }, headers: {} });
    expect(result).toBeUndefined();
  });

  it('returns undefined when handshake.auth.token is not a string (kills typeof guard)', () => {
    const result = extractToken({ auth: { token: 123 }, headers: {} });
    expect(result).toBeUndefined();
  });

  it('falls back to Authorization Bearer header when auth.token missing (kills header[authorization] StringLiteral)', () => {
    const result = extractToken({ auth: {}, headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(result).toBe('abc.def.ghi');
  });

  it('strips the literal "Bearer " prefix (7 chars) from header (kills slice("".length) and method mutants)', () => {
    const token = 'header.payload.sig';
    const result = extractToken({ auth: {}, headers: { authorization: `Bearer ${token}` } });
    expect(result).toBe(token);
    // Sanity: not just any 7-char prefix; "Bearer " must literally match
    expect(result?.startsWith('Bearer')).toBe(false);
  });

  it('returns undefined for non-Bearer Authorization scheme (kills startsWith mutants)', () => {
    const result = extractToken({ auth: {}, headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    expect(result).toBeUndefined();
  });

  it('returns undefined when Authorization header is not a string (kills typeof header guard)', () => {
    const result = extractToken({ auth: {}, headers: { authorization: undefined } });
    expect(result).toBeUndefined();
  });

  it('returns undefined when neither auth.token nor Authorization header present', () => {
    const result = extractToken({ auth: {}, headers: {} });
    expect(result).toBeUndefined();
  });

  it('prefers auth.token over Authorization header when both present (kills early-return mutant)', () => {
    const result = extractToken({
      auth: { token: 'from-auth' },
      headers: { authorization: 'Bearer from-header' },
    });
    expect(result).toBe('from-auth');
  });

  it('reads from headers["authorization"] specifically — not "" key (kills headers[""] mutant)', () => {
    // If mutant flips key to "", it would read headers[""] which is undefined.
    // Real header lookup must read "authorization" key.
    const result = extractToken({ auth: {}, headers: { authorization: 'Bearer x' } });
    expect(result).toBe('x');
  });

  it('rejects header that ends with "Bearer " but does not start with it (kills endsWith mutant)', () => {
    // Mutant: header.startsWith → header.endsWith. "xxxBearer " ends with but
    // does not start with "Bearer ", so original returns undefined while
    // mutant tries header.slice(7) on it.
    const result = extractToken({ auth: {}, headers: { authorization: 'xxxBearer ' } });
    expect(result).toBeUndefined();
  });
});

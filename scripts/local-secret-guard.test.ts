// File: FleetManagement/scripts/local-secret-guard.test.ts
//
// Covers the PURE cores: (1) detection of production credential literals in
// local env files, (2) detection of production TOPOLOGY in tracked source, and
// the report renderer. No filesystem or git access -- bodies and hash sets are
// passed in directly, mirroring the pure-core/impure-driver split used by
// inspect-prod-deploy.ts and railway-reference-guard.ts.
//
// FIXTURE HYGIENE: this file tests a CREDENTIAL DETECTOR, so its fixtures must
// be credential-SHAPED by construction -- exactly the case where a careless
// fixture leaks something real. Both hazards are removed:
//   - hosts are RFC 2606 / BCP 32 reserved (.invalid, localhost), so no real
//     production topology is ever committed;
//   - passwords are generated per run with randomBytes, so the
//     credential-shaped string is assembled at RUNTIME and no literal exists in
//     source for detect-secrets or GitGuardian to flag.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  findViolationsInEnv,
  findForbiddenHostsInSource,
  loadForbiddenHostHashes,
  sha256Host,
  formatReport,
} from './local-secret-guard';

// Synthetic per-run credentials: never literals, never real values.
const FAKE_PASSWORD = 'pw-' + randomBytes(8).toString('hex');
const PROD_LITERAL = 'postgresql://appuser:' + FAKE_PASSWORD + '@db.example.invalid:5432/appdb';
const LOCAL_DEV_DSN =
  'postgresql://fleet:' + randomBytes(4).toString('hex') + '@localhost:5432/fleet';

describe('findViolationsInEnv', () => {
  it('flags the exact line shape that caused the incident', () => {
    const body = ['JWT_ISSUER=fleet-pilot-api', 'PROD_DATABASE_URL=' + PROD_LITERAL].join('\n');
    const found = findViolationsInEnv('.env', body);
    expect(found).toHaveLength(1);
    expect(found[0]?.variable).toBe('PROD_DATABASE_URL');
    expect(found[0]?.line).toBe(2);
  });

  it('NEVER records the credential value itself', () => {
    const found = findViolationsInEnv('.env', 'PROD_DATABASE_URL=' + PROD_LITERAL);
    expect(JSON.stringify(found)).not.toContain(FAKE_PASSWORD);
  });

  it('ALLOWS a local developer DATABASE_URL (docker compose)', () => {
    // Local development must not be punished. The value here IS
    // credential-shaped, so this proves the guard keys on the PROD-scoped
    // variable NAME, not merely on the URL shape.
    expect(findViolationsInEnv('.env', 'DATABASE_URL=' + LOCAL_DEV_DSN)).toEqual([]);
  });

  it('ignores comments and blank lines', () => {
    const body = ['# PROD_DATABASE_URL=' + PROD_LITERAL, '', '   '].join('\n');
    expect(findViolationsInEnv('.env', body)).toEqual([]);
  });

  it('sees through surrounding quotes', () => {
    const body = 'PROD_DATABASE_URL=\u0022' + PROD_LITERAL + '\u0022';
    expect(findViolationsInEnv('.env', body)).toHaveLength(1);
  });

  it('does not flag a prod-scoped var holding a non-credential value', () => {
    const body = [
      'PROD_DATABASE_URL=postgresql://db.example.invalid:5432/appdb',
      'PROD_API_URL=https://api.example.invalid',
    ].join('\n');
    expect(findViolationsInEnv('.env', body)).toEqual([]);
  });

  it('tolerates CRLF line endings', () => {
    const body = 'A=1\r\nPROD_DATABASE_URL=' + PROD_LITERAL + '\r\n';
    const found = findViolationsInEnv('.env', body);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
  });
});

describe('findForbiddenHostsInSource', () => {
  // A stand-in for a real prod host. The guard matches on HASH, so the test
  // never needs -- and must never use -- an actual production hostname.
  const SECRET_HOST = 'sneaky-proxy-' + randomBytes(4).toString('hex') + '.example.invalid';
  const forbidden = new Set([sha256Host(SECRET_HOST)]);

  it('catches production topology pasted into a test fixture', () => {
    // The precise mistake this check exists to prevent: a real prod host
    // embedded in a fixture, which the env-file check cannot see.
    const body = 'const DSN = \u0027postgresql://u:p@' + SECRET_HOST + ':5432/db\u0027;';
    const found = findForbiddenHostsInSource('scripts/some.test.ts', body, forbidden);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  it('NEVER echoes the hostname -- only a hash prefix', () => {
    const found = findForbiddenHostsInSource('a.ts', SECRET_HOST, forbidden);
    expect(JSON.stringify(found)).not.toContain(SECRET_HOST);
    expect(found[0]?.hashPrefix).toHaveLength(12);
  });

  it('is case-insensitive (hashing is on the lowercased host)', () => {
    const found = findForbiddenHostsInSource('a.ts', SECRET_HOST.toUpperCase(), forbidden);
    expect(found).toHaveLength(1);
  });

  it('reports every offending line', () => {
    const body = ['x = ' + SECRET_HOST, 'ok = example.com', 'y = ' + SECRET_HOST].join('\n');
    const found = findForbiddenHostsInSource('a.ts', body, forbidden);
    expect(found.map((f) => f.line)).toEqual([1, 3]);
  });

  it('does not flag ordinary dotted tokens (no false positives by construction)', () => {
    const body = [
      'import x from "./a.js";',
      'const f = "package.json";',
      'api.example.invalid',
    ].join('\n');
    expect(findForbiddenHostsInSource('a.ts', body, forbidden)).toEqual([]);
  });

  it('is a no-op when no hashes are configured', () => {
    expect(findForbiddenHostsInSource('a.ts', SECRET_HOST, new Set())).toEqual([]);
  });
});

describe('loadForbiddenHostHashes', () => {
  it('reads valid 64-char hashes and ignores malformed entries', () => {
    const good = sha256Host('db.example.invalid');
    const body = JSON.stringify({
      forbiddenHostSha256: [
        { sha256: good, note: 'ok' },
        { sha256: 'too-short' },
        { note: 'missing sha' },
      ],
    });
    const set = loadForbiddenHostHashes(body);
    expect(set.has(good)).toBe(true);
    expect(set.size).toBe(1);
  });

  it('returns an empty set when the key is absent', () => {
    expect(loadForbiddenHostHashes('{}').size).toBe(0);
  });
});

describe('formatReport', () => {
  it('reports OK when there are no violations', () => {
    expect(formatReport([], [])).toMatch(/OK --/);
  });

  it('names the file, line and variable, and prescribes the runtime fix', () => {
    const report = formatReport([{ file: '.env', line: 12, variable: 'PROD_DATABASE_URL' }], []);
    expect(report).toContain('.env:12');
    expect(report).toContain('PROD_DATABASE_URL');
    expect(report).toContain('prod:db-url');
  });

  it('explains WHY topology leaks cannot be undone', () => {
    const report = formatReport([], [{ file: 'a.ts', line: 3, hashPrefix: 'abc123def456' }]);
    expect(report).toContain('PRODUCTION TOPOLOGY');
    expect(report).toContain('a.ts:3');
    expect(report).toContain('abc123def456');
    expect(report).toMatch(/RFC 2606/);
    expect(report).toMatch(/PERMANENT/);
  });

  it('reports both categories together', () => {
    const report = formatReport(
      [{ file: '.env', line: 1, variable: 'PROD_DATABASE_URL' }],
      [{ file: 'a.ts', line: 2, hashPrefix: 'aaaaaaaaaaaa' }],
    );
    expect(report).toContain('credential literal(s)');
    expect(report).toContain('PRODUCTION TOPOLOGY');
  });
});

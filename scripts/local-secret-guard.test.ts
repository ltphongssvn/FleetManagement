// File: FleetManagement/scripts/local-secret-guard.test.ts
//
// Covers the PURE core: detection of production credential literals in local
// env files, and the report renderer. No filesystem access -- bodies are passed
// in directly, mirroring the pure-core/impure-driver split used by
// inspect-prod-deploy.ts and railway-reference-guard.ts.
import { describe, it, expect } from 'vitest';
import { findViolationsInEnv, formatReport } from './local-secret-guard';

const PROD_LITERAL =
  'postgresql://postgres:rotated-s3cr3t@trolley.proxy.rlwy.net:30812/railway';

describe('findViolationsInEnv', () => {
  it('flags the exact line that caused the incident', () => {
    const body = ['JWT_ISSUER=fleet-pilot-api', 'PROD_DATABASE_URL=' + PROD_LITERAL].join('\n');
    const found = findViolationsInEnv('.env', body);
    expect(found).toHaveLength(1);
    expect(found[0]?.variable).toBe('PROD_DATABASE_URL');
    expect(found[0]?.line).toBe(2);
  });

  it('NEVER records the credential value itself', () => {
    const found = findViolationsInEnv('.env', 'PROD_DATABASE_URL=' + PROD_LITERAL);
    expect(JSON.stringify(found)).not.toContain('rotated-s3cr3t');
  });

  it('ALLOWS a local developer DATABASE_URL (docker compose)', () => {
    // Local development must not be punished: only PROD-scoped names are
    // credentials that belong to a rotating system of record.
    const body = 'DATABASE_URL=postgresql://fleet:fleet@localhost:5432/fleet';
    expect(findViolationsInEnv('.env', body)).toEqual([]);
  });

  it('ignores comments and blank lines', () => {
    const body = [
      '# PROD_DATABASE_URL=' + PROD_LITERAL,
      '',
      '   ',
    ].join('\n');
    expect(findViolationsInEnv('.env', body)).toEqual([]);
  });

  it('sees through surrounding quotes', () => {
    const body = 'PROD_DATABASE_URL=\u0022' + PROD_LITERAL + '\u0022';
    expect(findViolationsInEnv('.env', body)).toHaveLength(1);
  });

  it('does not flag a prod-scoped var holding a non-credential value', () => {
    // A reference or a URL without inline credentials is exactly the desired
    // state and must stay clean.
    const body = [
      'PROD_DATABASE_URL=postgresql://trolley.proxy.rlwy.net:30812/railway',
      'PROD_API_URL=https://xe.vominhchau.com',
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

describe('formatReport', () => {
  it('reports OK when there are no violations', () => {
    expect(formatReport([])).toMatch(/OK --/);
  });

  it('names the file, line and variable, and prescribes the runtime fix', () => {
    const report = formatReport([
      { file: '.env', line: 12, variable: 'PROD_DATABASE_URL' },
    ]);
    expect(report).toContain('.env:12');
    expect(report).toContain('PROD_DATABASE_URL');
    expect(report).toContain('prod:db-url');
  });
});

// File: FleetManagement/scripts/local-secret-guard.ts
//
// Guard: no PRODUCTION credential literal may sit in a local .env file.
//
// Why this is NOT redundant with the existing protections:
//   - .pre-commit-config.yaml check-env-files blocks COMMITTING a .env.
//   - detect-secrets scans STAGED content.
// Both operate on git. A local .env is untracked BY DESIGN, so neither ever
// inspects it. That is exactly how a PROD_DATABASE_URL literal sat in .env
// undetected until prod credentials rotated and every prod-ops CLI began
// failing authentication. The blind spot is the working tree, not the index.
//
// The rule enforced: a production connection string is resolved at RUNTIME
// from its single system of record (see scripts/prod-db-url.ts), never pasted
// into a file. This is the local-ops mirror of railway-reference-guard.ts,
// which enforces the same principle for Railway service variables.
//
// Exit codes: 0 = clean, 1 = violations found, 2 = tooling error.
//
// Run: pnpm exec turbo run guard:local-secrets
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Env files checked in the working tree (untracked by design -> git-blind). */
export const SCANNED_FILES: readonly string[] = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.prod',
];

// A connection string carrying inline credentials: scheme://user:secret@host
// Mirrors railway-reference-guard credentialUrlPattern so both guards agree on
// what 'a credential literal' means.
const CREDENTIAL_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#@\s]+:[^@/?#\s]+@/;

// Variables whose value must never be a local literal. PROD-scoped names only:
// a developer LOCAL DATABASE_URL (docker compose) is legitimate and must stay
// allowed, or the guard would punish normal local development.
const PROD_VARIABLE_RE = /^(?:PROD|PRODUCTION)_[A-Z0-9_]*(?:URL|DSN|PASSWORD|SECRET)$/;

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly variable: string;
}

/** PURE: find prod-credential literals in one env file body. */
export function findViolationsInEnv(file: string, body: string): Violation[] {
  const out: Violation[] = [];
  const lines = body.split(/(?:\r\n|\r|\n)/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').trim();
    if (raw === '' || raw.startsWith('#')) continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const variable = raw.slice(0, eq).trim();
    // Strip optional surrounding quotes from the value.
    const value = raw.slice(eq + 1).trim().replace(/^['\u0022]|['\u0022]$/g, '');
    if (value === '') continue;
    const isProdName = PROD_VARIABLE_RE.test(variable);
    const isCredentialLiteral = CREDENTIAL_URL_RE.test(value);
    if (isProdName && isCredentialLiteral) {
      // Record the NAME and LOCATION only -- never the value.
      out.push({ file, line: i + 1, variable });
    }
  }
  return out;
}

/** PURE: render the operator-facing report for a violation set. */
export function formatReport(violations: readonly Violation[]): string {
  if (violations.length === 0) {
    return 'local-secret-guard: OK -- no production credential literals in local env files.';
  }
  const head =
    'local-secret-guard: FAIL -- ' + String(violations.length) +
    ' production credential literal(s) found in local env file(s):';
  const body = violations
    .map((v) => '  - ' + v.file + ':' + String(v.line) + ' -> ' + v.variable)
    .join('\n');
  const fix = [
    '',
    'Fix: delete the line. A stored copy of a production credential is a SECOND',
    'system of record; it goes stale the moment prod rotates and every prod-ops',
    'task then fails authentication. Resolve it at runtime instead:',
    '',
    '  DATABASE_URL=\u0024(pnpm prod:db-url) \\',
    '    pnpm exec turbo run audit:assignment-uniqueness --filter=@fleet/api',
  ].join('\n');
  return head + '\n' + body + fix;
}

function main(): void {
  const root = process.cwd();
  const violations: Violation[] = [];
  for (const file of SCANNED_FILES) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    let body: string;
    try {
      body = readFileSync(path, 'utf8');
    } catch (e) {
      process.stderr.write(
        'local-secret-guard: cannot read ' + file + ': ' +
          (e instanceof Error ? e.message : String(e)) + '\n',
      );
      process.exit(2);
    }
    violations.push(...findViolationsInEnv(file, body));
  }
  const report = formatReport(violations);
  if (violations.length === 0) {
    process.stdout.write(report + '\n');
    process.exit(0);
  }
  process.stderr.write(report + '\n');
  process.exit(1);
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('local-secret-guard.ts') || invoked.endsWith('local-secret-guard.js')) {
  main();
}

// File: FleetManagement/scripts/local-secret-guard.ts
//
// Guard against leaking production secrets and production TOPOLOGY from a
// developer machine. Two independent checks, both born from real incidents.
//
// CHECK 1 -- production credential literal in a local env file.
//   Existing protections do not cover this: pre-commit check-env-files blocks
//   COMMITTING a .env, and detect-secrets scans STAGED content. Both operate on
//   git, but a local .env is untracked BY DESIGN, so neither ever inspects it.
//   That is exactly how a PROD_DATABASE_URL literal sat in .env undetected until
//   prod credentials rotated and every prod-ops CLI began failing auth. The
//   blind spot is the working tree, not the index.
//
// CHECK 2 -- production topology anywhere in TRACKED source.
//   Added after CHECK 1 shipped and promptly failed to catch its own author: a
//   test fixture in this very PR embedded the live prod database host and port.
//   The passwords there were synthetic, so nothing needed rotating, but the
//   hostname was real and would have been the first commit of it to this repo.
//   A guard that only reads .env cannot see that. Once pushed, such data is
//   effectively PERMANENT -- GitHub does not garbage-collect pushed objects even
//   after a force-push, and serves them from CDN caches, forks and clones -- so
//   prevention is the only control that actually works. Hence a pre-merge gate.
//
//   Forbidden hosts are stored as SHA-256 HASHES, never plaintext, so this guard
//   cannot itself leak the topology it protects -- the same reasoning as the
//   hashed_secret field in .secrets.baseline. Findings are reported by hash
//   prefix and never echo the matched hostname.
//
// Exit codes: 0 = clean, 1 = violations found, 2 = tooling error.
//
// Run:        pnpm exec turbo run guard:local-secrets
// Rebaseline: pnpm run guard:local-secrets:baseline
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Env files checked in the working tree (untracked by design -> git-blind). */
export const SCANNED_FILES: readonly string[] = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.prod',
];

export const CONFIG_FILE = 'scripts/local-secret-guard.config.json';

// Matches a connection string whose AUTHORITY section embeds credentials --
// that is, a scheme, then a userinfo pair (user and password separated by a
// colon), then an at-sign, then the host. The shape is described in prose
// rather than shown as a literal example ON PURPOSE: a written-out sample of
// that form is itself credential-shaped, so every value-based scanner
// (detect-secrets locally, GitGuardian in CI) flags the documentation. An
// allowlist pragma would only silence the local scanner and would drift; not
// writing the shape at all leaves nothing for any scanner to match.
// Mirrors railway-reference-guard credentialUrlPattern so both guards agree on
// what a credential literal means.
const CREDENTIAL_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#@\s]+:[^@/?#\s]+@/;

// PROD-scoped names only: a developer LOCAL DATABASE_URL (docker compose) is
// legitimate and must stay allowed, or the guard would punish normal work.
const PROD_VARIABLE_RE = /^(?:PROD|PRODUCTION)_[A-Z0-9_]*(?:URL|DSN|PASSWORD|SECRET)$/;

// Dotted host-like tokens. Deliberately broad -- it also matches package.json,
// file.ts and so on -- because a match is decided by HASH EQUALITY, not by this
// pattern. Over-matching costs a hash; under-matching would miss a leak.
const HOST_TOKEN_RE = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

// Machine-generated or binary content: no human pastes topology there.
const SKIP_FILE_RE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|wav|mp3|mp4|woff2?|ttf|eot|keystore|jks|p8|p12)$/i;

const LINE_SPLIT_RE = /(?:\r\n|\r|\n)/;
const QUOTE_STRIP_RE = /^['\u0022]|['\u0022]$/g;

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly variable: string;
}

export interface HostViolation {
  readonly file: string;
  readonly line: number;
  /** First 12 hex chars of the matched hash: identifies WHICH rule fired
   *  without ever printing the hostname itself. */
  readonly hashPrefix: string;
}

/** PURE: find prod-credential literals in one env file body. */
export function findViolationsInEnv(file: string, body: string): Violation[] {
  const out: Violation[] = [];
  const lines = body.split(LINE_SPLIT_RE);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? '').trim();
    if (raw === '' || raw.startsWith('#')) continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const variable = raw.slice(0, eq).trim();
    const value = raw
      .slice(eq + 1)
      .trim()
      .replace(QUOTE_STRIP_RE, '');
    if (value === '') continue;
    if (PROD_VARIABLE_RE.test(variable) && CREDENTIAL_URL_RE.test(value)) {
      // Record the NAME and LOCATION only -- never the value.
      out.push({ file, line: i + 1, variable });
    }
  }
  return out;
}

/** PURE: parse the hash allowlist out of the config body. */
export function loadForbiddenHostHashes(configBody: string): Set<string> {
  const parsed: unknown = JSON.parse(configBody);
  const rec = parsed as { forbiddenHostSha256?: unknown };
  const entries = Array.isArray(rec.forbiddenHostSha256) ? rec.forbiddenHostSha256 : [];
  const out = new Set<string>();
  for (const e of entries) {
    const sha = (e as { sha256?: unknown }).sha256;
    if (typeof sha === 'string' && sha.length === 64) out.add(sha.toLowerCase());
  }
  return out;
}

export function sha256Host(host: string): string {
  return createHash('sha256').update(host.toLowerCase()).digest('hex');
}

/** PURE: flag any token whose hash matches a forbidden production host. */
export function findForbiddenHostsInSource(
  file: string,
  body: string,
  forbidden: ReadonlySet<string>,
): HostViolation[] {
  if (forbidden.size === 0) return [];
  const out: HostViolation[] = [];
  const lines = body.split(LINE_SPLIT_RE);
  for (let i = 0; i < lines.length; i += 1) {
    const matches = (lines[i] ?? '').match(HOST_TOKEN_RE);
    if (matches === null) continue;
    for (const token of matches) {
      const digest = sha256Host(token);
      if (forbidden.has(digest)) {
        out.push({ file, line: i + 1, hashPrefix: digest.slice(0, 12) });
      }
    }
  }
  return out;
}

/** PURE: render the operator-facing report. */
export function formatReport(
  violations: readonly Violation[],
  hostViolations: readonly HostViolation[] = [],
): string {
  if (violations.length === 0 && hostViolations.length === 0) {
    return (
      'local-secret-guard: OK -- no production credential literals in local env ' +
      'files, and no production topology in tracked source.'
    );
  }
  const parts: string[] = [];
  if (violations.length > 0) {
    parts.push(
      'local-secret-guard: FAIL -- ' +
        String(violations.length) +
        ' production credential literal(s) in local env file(s):',
    );
    for (const v of violations) {
      parts.push('  - ' + v.file + ':' + String(v.line) + ' -> ' + v.variable);
    }
    parts.push(
      '',
      'Fix: delete the line. A stored copy of a production credential is a SECOND',
      'system of record; it goes stale the moment prod rotates and every prod-ops',
      'task then fails authentication. Resolve it at runtime instead:',
      '',
      '  DATABASE_URL=\u0024(pnpm prod:db-url) \\',
      '    pnpm exec turbo run audit:assignment-uniqueness --filter=@fleet/api',
    );
  }
  if (hostViolations.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push(
      'local-secret-guard: FAIL -- ' +
        String(hostViolations.length) +
        ' occurrence(s) of PRODUCTION TOPOLOGY in tracked source:',
    );
    for (const h of hostViolations) {
      parts.push(
        '  - ' +
          h.file +
          ':' +
          String(h.line) +
          ' -> forbidden host [sha256 ' +
          h.hashPrefix +
          '...]',
      );
    }
    parts.push(
      '',
      'Fix: never put a real production hostname in tracked source -- not even in',
      'a test fixture. Use an RFC 2606 / BCP 32 reserved name (.invalid, .example,',
      '.test, localhost), which can never resolve to real infrastructure, and',
      'resolve real endpoints at runtime via pnpm prod:db-url.',
      '',
      'This matters because the exposure is effectively PERMANENT once pushed:',
      'GitHub does not garbage-collect pushed objects even after a force-push, and',
      'serves them from CDN caches, forks and clones. Prevention is the control.',
    );
  }
  return parts.join('\n');
}

function trackedFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\u0000').filter((f) => f !== '' && !SKIP_FILE_RE.test(f));
}

function main(): void {
  const root = process.cwd();
  const violations: Violation[] = [];
  const hostViolations: HostViolation[] = [];

  for (const file of SCANNED_FILES) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    violations.push(...findViolationsInEnv(file, readFileSync(path, 'utf8')));
  }

  const configPath = resolve(root, CONFIG_FILE);
  if (existsSync(configPath)) {
    let forbidden: ReadonlySet<string>;
    try {
      forbidden = loadForbiddenHostHashes(readFileSync(configPath, 'utf8'));
    } catch (e) {
      process.stderr.write(
        'local-secret-guard: invalid config at ' +
          CONFIG_FILE +
          ': ' +
          (e instanceof Error ? e.message : String(e)) +
          '\n',
      );
      process.exit(2);
    }
    for (const file of trackedFiles(root)) {
      let body: string;
      try {
        body = readFileSync(resolve(root, file), 'utf8');
      } catch {
        continue; // unreadable/binary: nothing a human pasted topology into
      }
      hostViolations.push(...findForbiddenHostsInSource(file, body, forbidden));
    }
  }

  const report = formatReport(violations, hostViolations);
  const clean = violations.length === 0 && hostViolations.length === 0;
  if (clean) {
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

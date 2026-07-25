// File: FleetManagement/scripts/prod-db-url.ts
//
// Root-cause fix: resolve the PRODUCTION Postgres DSN from Railway at RUNTIME,
// so no prod credential is ever stored in a local .env.
//
// The incident: every prod-ops turbo task (audit:assignment-uniqueness,
// inspect:order-state, projection:rebuild, ...) declares passThroughEnv
// DATABASE_URL, and operators fed it from a PROD_DATABASE_URL line pasted into
// .env. Prod credentials rotate; the pasted copy does not. It went stale and
// every prod-ops CLI failed authentication. Re-pasting the new password fixes
// today and re-breaks at the next rotation -- a treadmill, not a fix.
//
// The rule (2026 practice): a credential lives in exactly ONE system of record
// and every consumer reads it from there at call time. Here that system is
// Railway itself. This is the LOCAL-OPS MIRROR of railway-reference-guard.ts,
// which already forbids hardcoded connection-string literals in Railway service
// variables for the identical reason: a reference tracks rotation, a literal
// rots. That guard covered the deploy side; the local side was uncovered.
//
// Usage -- capture the live DSN for a single prod-ops invocation:
//   DATABASE_URL="$(pnpm prod:db-url)" \
//     pnpm exec turbo run audit:assignment-uniqueness --filter=@fleet/api
//
// ONLY the DSN is written to stdout; every diagnostic goes to stderr, so
// command substitution captures exactly the URL and nothing else.
//
// Schema note (two-axis rule): this root script sits OUTSIDE the api package,
// so it does not import apps/api EnvSchema -- that would be a cross-boundary
// reach for one primitive. A URL check is a primitive, not a duplicated
// contract shape, so a local z.url() is correct here (same carve-out the
// schema-first doc grants NODE_ENV: do not over-abstract env).
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

/** Railway service that owns the production database. */
export const PROD_DB_SERVICE = 'Postgres';
/** Variable holding the public-proxy DSN (reachable from an operator machine). */
export const PROD_DB_URL_VARIABLE = 'DATABASE_PUBLIC_URL';

/**
 * Explicit Railway targeting -- the second half of the root-cause fix.
 *
 * The CLI resolves project/service from a DIRECTORY LINK written per-directory
 * by railway link. This repo cannot rely on that: it runs ~30 parallel git
 * worktrees and every fresh one starts UNLINKED, so a resolver depending on the
 * CWD link dies with 'Service not found' in each new worktree. Hand-linking every
 * worktree is a treadmill -- the same hidden, rotting environmental state this
 * script exists to eliminate. Targeting project + environment + service
 * EXPLICITLY makes the command work from ANY directory, mirroring
 * .github/workflows/railway-guard.yml, which runs the CLI in CI with no link.
 *
 * The project id is deployment TOPOLOGY, not a secret:
 * railway-reference-guard.config.json already commits service UUIDs. Env
 * overrides let CI or another environment retarget with no code change.
 */
export const PROD_DB_PROJECT_ID = '3eeb4f8d-4f78-4f59-a1a9-1c6a1b07db36';
export const PROD_DB_ENVIRONMENT = 'production';

/**
 * PURE: the exact argv used to read the variable, independent of any directory
 * link. Uses the modern 'variable list' form with --kv, which prints raw values one
 * KEY=VALUE per line; the default table rendering CLIPS long values and would
 * silently yield a truncated, unusable DSN.
 */
export function buildRailwayArgs(env: Record<string, string | undefined> = {}): string[] {
  return [
    'variable',
    'list',
    '--project', env['RAILWAY_PROJECT_ID'] ?? PROD_DB_PROJECT_ID,
    '--environment', env['RAILWAY_ENVIRONMENT'] ?? PROD_DB_ENVIRONMENT,
    '--service', env['RAILWAY_DB_SERVICE'] ?? PROD_DB_SERVICE,
    '--kv',
  ];
}

// A bare z.url() is NOT sufficient: the WHATWG URL parser accepts
// 'postgresql://' (empty host is legal for a non-special scheme), which is
// EXACTLY the shape Railway default table rendering produces when it CLIPS a
// long value. Such a DSN would sail through validation and fail only at
// connection time, reintroducing the opaque failure this script removes.
// Require a postgres scheme AND a non-empty host so a clipped value is
// rejected at the boundary.
const DsnSchema = z.url().refine((value) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const schemeOk = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  return schemeOk && parsed.hostname.length > 0;
});

/** Injectable command runner: keeps the resolver unit-testable without the CLI. */
export type CliRunner = () => string;

// Transient upstream signatures (same class railway-reference-guard handles):
// a 429/5xx/non-JSON body or a network blip is infrastructure-side and clears
// on retry. It is NOT a stale-credential or config error and must not be
// reported as one.
const TRANSIENT_CLI_SIGNATURES: readonly RegExp[] = [
  /error decoding response body/i,
  /expected value at line 1 column 1/i,
  /failed to fetch/i,
  /rate limit/i,
  /timed? ?out/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i,
];

export function isTransientCliError(message: string): boolean {
  return TRANSIENT_CLI_SIGNATURES.some((re) => re.test(message));
}

/**
 * PURE: extract + validate the DSN from 'railway variables --kv' output.
 * --kv emits one KEY=VALUE per line (no table truncation, unlike the default
 * rendering, which clips long values and silently yields an unusable DSN).
 * The value is everything after the FIRST = so a value containing = survives.
 */
export function parseProdDbUrl(kvOutput: string): string {
  const prefix = PROD_DB_URL_VARIABLE + '=';
  const line = kvOutput
    .split(/(?:\r\n|\r|\n)/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(prefix));
  if (line === undefined) {
    throw new Error(
      PROD_DB_URL_VARIABLE + ' not found for Railway service ' + PROD_DB_SERVICE +
        '. Is the Railway CLI linked to the right project/environment?',
    );
  }
  const rawValue = line.slice(prefix.length).trim();
  const parsed = DsnSchema.safeParse(rawValue);
  if (!parsed.success) {
    // NEVER echo the value: it carries the password. Report the shape only.
    throw new Error(
      'Resolved ' + PROD_DB_URL_VARIABLE + ' is not a valid URL DSN (value withheld).',
    );
  }
  return parsed.data;
}

export interface ResolveOptions {
  readonly maxAttempts?: number;
  readonly onRetry?: (attempt: number, message: string) => void;
}

/**
 * Resolve with bounded retry on TRANSIENT CLI errors only. A non-transient
 * failure (CLI missing, not linked, bad auth) throws immediately: there is no
 * safe fallback for a production DSN, and a silent fallback is exactly the
 * failure mode this script exists to remove.
 */
export function resolveProdDbUrl(runner: CliRunner, options: ResolveOptions = {}): string {
  const maxAttempts = options.maxAttempts ?? 4;
  let lastMessage = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return parseProdDbUrl(runner());
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e);
      if (!isTransientCliError(lastMessage) || attempt === maxAttempts) throw e;
      if (options.onRetry) options.onRetry(attempt, lastMessage);
    }
  }
  /* c8 ignore next -- loop always returns or throws */
  throw new Error('prod-db-url: exhausted retries: ' + lastMessage);
}

function railwayKvRunner(): string {
  return execFileSync('railway', buildRailwayArgs(process.env), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function main(): void {
  try {
    const url = resolveProdDbUrl(railwayKvRunner, {
      onRetry: (attempt, message) => {
        process.stderr.write(
          'prod-db-url: transient Railway CLI error on attempt ' +
            String(attempt) + ' (retrying): ' + message + '\n',
        );
      },
    });
    process.stdout.write(url);
  } catch (e) {
    process.stderr.write(
      'prod-db-url: ' + (e instanceof Error ? e.message : String(e)) + '\n',
    );
    process.exit(1);
  }
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('prod-db-url.ts') || invoked.endsWith('prod-db-url.js')) {
  main();
}

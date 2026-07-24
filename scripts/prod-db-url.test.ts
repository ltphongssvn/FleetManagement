// File: FleetManagement/scripts/prod-db-url.test.ts
//
// Covers the PURE core of the runtime prod-DSN resolver. The Railway CLI is
// never invoked: resolveProdDbUrl takes an injectable runner, so every branch
// (parse, missing var, malformed value, transient retry, hard failure) is
// exercised deterministically -- the same shape inspect-prod-deploy.test.ts
// uses for computeDeployVerdict.
import { describe, it, expect, vi } from 'vitest';
import {
  parseProdDbUrl,
  resolveProdDbUrl,
  isTransientCliError,
  buildRailwayArgs,
  PROD_DB_URL_VARIABLE,
  PROD_DB_PROJECT_ID,
  PROD_DB_ENVIRONMENT,
  PROD_DB_SERVICE,
} from './prod-db-url';

const DSN = 'postgresql://postgres:s3cr3t-rotated@trolley.proxy.rlwy.net:30812/railway';

function kv(lines: readonly string[]): string {
  return lines.join('\n') + '\n';
}

describe('parseProdDbUrl', () => {
  it('extracts the DSN from --kv output among other variables', () => {
    const out = kv([
      'PGDATA=/var/lib/postgresql/data/pgdata',
      PROD_DB_URL_VARIABLE + '=' + DSN,
      'RAILWAY_TCP_PROXY_PORT=30812',
    ]);
    expect(parseProdDbUrl(out)).toBe(DSN);
  });

  it('tolerates CRLF line endings and surrounding whitespace', () => {
    const out = 'A=1\r\n  ' + PROD_DB_URL_VARIABLE + '=' + DSN + '  \r\nB=2';
    expect(parseProdDbUrl(out)).toBe(DSN);
  });

  it('throws a linkage hint when the variable is absent', () => {
    expect(() => parseProdDbUrl(kv(['PGPORT=5432']))).toThrow(/not found for Railway service/);
  });

  it('rejects a truncated or malformed value WITHOUT echoing it', () => {
    const truncated = 'postgresql://';
    const out = kv([PROD_DB_URL_VARIABLE + '=' + truncated]);
    // The default (non---kv) Railway table rendering CLIPS long values; a
    // clipped DSN must fail loudly rather than reach a connection attempt.
    let message = '';
    try {
      parseProdDbUrl(out);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/not a valid URL DSN/);
    expect(message).not.toContain(truncated);
  });

  it('never leaks the password in the failure message', () => {
    const out = kv([PROD_DB_URL_VARIABLE + '=not-a-url-s3cr3t-rotated']);
    let message = '';
    try {
      parseProdDbUrl(out);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain('s3cr3t-rotated');
  });
});

describe('isTransientCliError', () => {
  it('classifies infrastructure blips as transient', () => {
    expect(isTransientCliError('Failed to fetch')).toBe(true);
    expect(isTransientCliError('connect ECONNRESET 10.0.0.1:443')).toBe(true);
    expect(isTransientCliError('request timed out')).toBe(true);
  });

  it('does NOT classify a config or auth failure as transient', () => {
    // These must surface immediately: retrying a bad login is pure latency.
    expect(isTransientCliError('Project not linked')).toBe(false);
    expect(isTransientCliError('Unauthorized')).toBe(false);
    expect(isTransientCliError(PROD_DB_URL_VARIABLE + ' not found for Railway service Postgres')).toBe(false);
  });
});

describe('resolveProdDbUrl', () => {
  it('returns the DSN on the first successful attempt', () => {
    const runner = vi.fn(() => kv([PROD_DB_URL_VARIABLE + '=' + DSN]));
    expect(resolveProdDbUrl(runner)).toBe(DSN);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure then succeeds', () => {
    let calls = 0;
    const runner = (): string => {
      calls += 1;
      if (calls < 3) throw new Error('Failed to fetch');
      return kv([PROD_DB_URL_VARIABLE + '=' + DSN]);
    };
    const onRetry = vi.fn();
    expect(resolveProdDbUrl(runner, { onRetry })).toBe(DSN);
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws IMMEDIATELY on a non-transient failure (no retry)', () => {
    const runner = vi.fn(() => {
      throw new Error('Unauthorized. Run railway login.');
    });
    expect(() => resolveProdDbUrl(runner)).toThrow(/Unauthorized/);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts transient failures', () => {
    const runner = vi.fn(() => {
      throw new Error('rate limit exceeded');
    });
    expect(() => resolveProdDbUrl(runner, { maxAttempts: 2 })).toThrow(/rate limit/);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe('buildRailwayArgs', () => {
  it('targets project, environment and service EXPLICITLY (never a directory link)', () => {
    // The bug this prevents: every fresh git worktree starts UNLINKED, so a
    // command relying on the CWD link fails with 'Service not found'. Explicit
    // flags make the resolver work from ANY directory.
    const args = buildRailwayArgs({});
    expect(args).toContain('--project');
    expect(args).toContain(PROD_DB_PROJECT_ID);
    expect(args).toContain('--environment');
    expect(args).toContain(PROD_DB_ENVIRONMENT);
    expect(args).toContain('--service');
    expect(args).toContain(PROD_DB_SERVICE);
  });

  it('requests --kv so long values are never table-truncated', () => {
    expect(buildRailwayArgs({})).toContain('--kv');
  });

  it('uses the modern \'variable list\' subcommand form', () => {
    const args = buildRailwayArgs({});
    expect(args[0]).toBe('variable');
    expect(args[1]).toBe('list');
  });

  it('lets env vars retarget project/environment/service with no code change', () => {
    const args = buildRailwayArgs({
      RAILWAY_PROJECT_ID: 'proj-staging',
      RAILWAY_ENVIRONMENT: 'staging',
      RAILWAY_DB_SERVICE: 'PostgresReplica',
    });
    expect(args).toContain('proj-staging');
    expect(args).toContain('staging');
    expect(args).toContain('PostgresReplica');
    expect(args).not.toContain(PROD_DB_PROJECT_ID);
  });
});

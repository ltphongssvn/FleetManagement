// File: FleetManagement/scripts/local-secret-guard-baseline.ts
//
// Regenerate scripts/local-secret-guard.config.json -- the SHA-256 hashes of
// production hostnames that must never appear in tracked source.
//
// The hash is DERIVED AT RUNTIME from the live Railway value via the same
// resolver the ops tasks use, so the plaintext hostname is never typed into a
// tracked file. That property is the whole point: a guard whose config leaked
// the very topology it protects would be self-defeating. Mirrors the
// hashed_secret field in .secrets.baseline.
//
// Run: pnpm run guard:local-secrets:baseline
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildRailwayArgs, parseProdDbUrl } from './prod-db-url';
import { CONFIG_FILE } from './local-secret-guard';

interface ForbiddenEntry {
  readonly sha256: string;
  readonly note: string;
}

export function buildConfig(entries: readonly ForbiddenEntry[]): string {
  return (
    JSON.stringify(
      {
        description:
          'Forbidden-topology hashes for local-secret-guard. Each entry is the ' +
          'SHA-256 of a lowercased PRODUCTION hostname that must never appear in ' +
          'tracked source. Hashes, not plaintext, so this config cannot itself ' +
          'leak the topology it protects. Regenerate with: ' +
          'pnpm run guard:local-secrets:baseline',
        forbiddenHostSha256: entries,
      },
      null,
      2,
    ) + '\n'
  );
}

export function hostOf(dsn: string): string {
  const host = new URL(dsn).hostname;
  if (host === '') throw new Error('resolved DSN has no hostname');
  return host;
}

function main(): void {
  const root = process.cwd();
  const kv = execFileSync('railway', buildRailwayArgs(process.env), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  const host = hostOf(parseProdDbUrl(kv));
  const sha256 = createHash('sha256').update(host.toLowerCase()).digest('hex');
  const body = buildConfig([
    { sha256, note: 'production database public proxy endpoint' },
  ]);
  writeFileSync(resolve(root, CONFIG_FILE), body);
  // Report the hash prefix only -- never the hostname.
  process.stdout.write(
    'local-secret-guard-baseline: wrote ' + CONFIG_FILE +
      ' with 1 forbidden host [sha256 ' + sha256.slice(0, 12) + '...]\n',
  );
}

const invoked = process.argv[1] ?? '';
if (
  invoked.endsWith('local-secret-guard-baseline.ts') ||
  invoked.endsWith('local-secret-guard-baseline.js')
) {
  main();
}

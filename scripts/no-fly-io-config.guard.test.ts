// scripts/no-fly-io-config.guard.test.ts
// DEPLOY.md opens by stating this runbook "supersedes any earlier Fly.io /
// Vercel notes, which were never used for this project". The tree disagreed:
// apps/api/fly.toml, workers/main-worker/fly.toml and a whole
// infra/terraform/ module provisioning two Fly.io apps, an S3 bucket and
// flyctl-managed Redis all shipped in every clone, plus a drizzle.config.ts
// comment telling the reader DATABASE_URL came from a Fly.io secret.
//
// Dead deployment config is worse than none: it reads as authoritative to
// anyone who has not been told otherwise, and this set described a topology
// that never existed. Removing it fixes today; this guard stops it returning.
//
// docs/adr/004 still references fly.toml and is deliberately untouched -- an
// ADR records what was decided at the time and must not be rewritten.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');
const at = (p: string): string => join(REPO_ROOT, p);

describe('no Fly.io deployment config', () => {
  it.each([
    'apps/api/fly.toml',
    'workers/main-worker/fly.toml',
    'apps/ops-web/fly.toml',
    'fly.toml',
  ])('has no %s', (p) => {
    expect(existsSync(at(p))).toBe(false);
  });

  it('has no Terraform module provisioning Fly.io apps', () => {
    expect(existsSync(at('infra/terraform'))).toBe(false);
  });

  it('keeps infra/localstack-init, which compose and e2e.yml both mount', () => {
    expect(existsSync(at('infra/localstack-init'))).toBe(true);
  });

  it('does not tell readers DATABASE_URL comes from a Fly.io secret', () => {
    expect(readFileSync(at('apps/api/drizzle.config.ts'), 'utf8')).not.toMatch(/Fly\.io/i);
  });

  it('DEPLOY.md still records that Fly.io was never used', () => {
    expect(readFileSync(at('DEPLOY.md'), 'utf8')).toMatch(/never used for this project/);
  });
});

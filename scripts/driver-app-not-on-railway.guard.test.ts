// scripts/driver-app-not-on-railway.guard.test.ts
// DEPLOY.md states driver-app ships as a mobile binary via EAS Build and is
// NOT a Railway service. A railway.json existed under apps/driver-app anyway,
// created alongside the api and ops-web configs in 92e8e01 by pattern rather
// than by decision, with a test asserting it built an Expo web export and
// served it. No such Railway service was ever created.
//
// That file was a loaded trap: Railway config defined in code overrides the
// dashboard, so pointing any service at apps/driver-app would have stood up an
// always-on container -- billed 24/7 -- with no further review. Deleting it
// fixes today; this guard stops it coming back.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');
const DEPLOY_MD = join(REPO_ROOT, 'DEPLOY.md');

describe('driver-app is not a Railway service', () => {
  it.each(['railway.json', 'railway.toml'])('has no %s', (name) => {
    expect(existsSync(join(REPO_ROOT, 'apps/driver-app', name))).toBe(false);
  });

  it('has no Railway config test asserting the opposite', () => {
    expect(existsSync(join(REPO_ROOT, 'apps/driver-app/test/railway-config.test.ts'))).toBe(false);
  });

  it('DEPLOY.md still records the decision this guard enforces', () => {
    const doc = readFileSync(DEPLOY_MD, 'utf8');
    expect(doc).toMatch(/driver-app[\s\S]{0,200}EAS Build/);
    expect(doc).toMatch(/NOT\*{0,2} a Railway service/);
  });
});

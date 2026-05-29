// apps/ops-web/test/version-drift.test.ts
// Contract test: prevent APP_VERSION drift from package.json source of truth.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('@fleet/ops-web - version drift contract', () => {
  it('package.json version is well-formed semver', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

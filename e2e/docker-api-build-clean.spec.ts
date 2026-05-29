// e2e/docker-api-build-clean.spec.ts
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe.serial('docker api image builds without native-build errors', () => {
  test('Dockerfile.api build log contains no gyp/compiler/python errors', () => {
    const repoRoot = process.cwd();
    const logPath = join(tmpdir(), 'fm-api-build-' + Date.now() + '.log');
    try {
      execSync(
        'docker build --no-cache --progress=plain -f Dockerfile.api -t fm-api-test . > ' +
          logPath + ' 2>&1',
        { cwd: repoRoot, shell: '/bin/bash', stdio: 'ignore', maxBuffer: 1024 * 1024 * 64 },
      );
    } catch {
      // non-zero exit still leaves the log on disk for assertions below
    }
    const log = readFileSync(logPath, 'utf8');

    const offenders = [
      'gyp ERR',
      'Unable to detect compiler type',
      'Could not find any Python installation',
    ];
    for (const needle of offenders) {
      const count = log.split(needle).length - 1;
      expect(count, needle + ' should not appear in build log').toBe(0);
    }
    expect(log).toContain('naming to docker.io');
  });
});

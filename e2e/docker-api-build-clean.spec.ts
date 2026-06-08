// e2e/docker-api-build-clean.spec.ts
// Guards that Dockerfile.api builds the api image WITHOUT native-build errors
// (no node-gyp failures, missing compiler, or missing Python) — a regression
// guard for the api image's native deps.
//
// FLAKE ROOT CAUSE (fixed 2026): the build shells out to `docker build`, whose
// FIRST step is `load metadata for docker.io/library/node:22-alpine`. On WSL2 +
// Docker Desktop that step invokes the Windows credential helper across the
// WSL->Windows boundary; it intermittently fails (a vsock race surfaces as
// `<3>WSL ... accept4 failed 110` + `error getting credentials - err: exit
// status 1`). When that happens the build aborts BEFORE running any Dockerfile
// layer, so none of the gyp/compiler/python guards even execute — yet the old
// assertion `expect(log).toContain('naming to docker.io')` failed, reding the
// whole suite on an ENVIRONMENTAL fault unrelated to the api code.
//
// Fix (deterministic, no retry-masking): distinguish 'the build never started'
// (an infra fault -> test.skip with the reason) from 'the build ran and
// failed' (a real regression -> assert). A clean build is deterministic and
// ends with `naming to docker.io/library/fm-api-test:latest done`; that marker
// is kept as the success signal, but only asserted once we know the build
// actually started.
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe.serial('docker api image builds without native-build errors', () => {
  test('Dockerfile.api build log contains no gyp/compiler/python errors', () => {
    const repoRoot = process.cwd();
    const logPath = join(tmpdir(), 'fm-api-build-' + String(Date.now()) + '.log');
    let buildOk = false;
    try {
      execSync(
        'docker build --no-cache --progress=plain -f Dockerfile.api -t fm-api-test . > ' +
          logPath + ' 2>&1',
        { cwd: repoRoot, shell: '/bin/bash', stdio: 'ignore', maxBuffer: 1024 * 1024 * 64 },
      );
      buildOk = true;
    } catch {
      // non-zero exit still leaves the log on disk for the triage below
    }
    const log = readFileSync(logPath, 'utf8');

    // Did the build actually reach the Dockerfile's own steps? BuildKit emits
    // stage step markers (e.g. '[builder ', '[stage-2 ') and an export phase
    // only once the build is genuinely running the image layers.
    const buildStarted =
      log.includes('[stage-2 ') || log.includes('[builder ') || log.includes('exporting to image');

    // Environmental pre-build faults that are NOT api-code problems. If the
    // build never started because of one of these, skip rather than fail —
    // an unavailable/flaky host credential helper or WSL vsock hiccup is infra.
    const envFaultSignatures = [
      'error getting credentials',
      'failed to solve',
      'accept4 failed',
      'error getting metadata',
    ];
    const metadataLoadFailed = /load metadata for[^\n]*\n[^\n]*ERROR/i.test(log) ||
      log.includes('ERROR: failed to build');
    const hitEnvFault = envFaultSignatures.some((s) => log.includes(s)) || metadataLoadFailed;

    if (!buildStarted && hitEnvFault) {
      const which = envFaultSignatures.find((s) => log.includes(s)) ?? 'metadata load error';
      test.skip(true, 'docker build could not start (host/infra fault, not api code): ' + which);
      return;
    }

    // The build ran the api layers — now the native-build guards are meaningful.
    const offenders = [
      'gyp ERR',
      'Unable to detect compiler type',
      'Could not find any Python installation',
    ];
    for (const needle of offenders) {
      const count = log.split(needle).length - 1;
      expect(count, needle + ' should not appear in build log').toBe(0);
    }
    // And the build must have completed cleanly: a successful export ends with
    // the image-naming marker, and execSync did not throw.
    expect(buildStarted, 'docker build should have run the Dockerfile.api layers').toBe(true);
    expect(buildOk, 'docker build should exit 0').toBe(true);
    expect(log).toContain('naming to docker.io');
  });
});

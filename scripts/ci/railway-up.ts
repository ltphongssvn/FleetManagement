// scripts/ci/railway-up.ts
// Driver: run railway up for one service, retrying ONLY a transient backend
// fault. All policy lives in railway-retry.ts (pure, unit-tested); this file
// owns nothing but IO, matching the house split used by pr:follow and
// inspect:prod-deploy.
//
// Replaces the bare shell step
//   run: railway up --service <name> --ci
// which had no retry at all, so the 2026-07-28 backboard timeout turned a
// docs-only deploy red and stranded production behind main until a human
// reran the job by hand.
//
// Output is streamed to the log AND captured, because the classifier needs the
// text and the operator needs to watch the build. Exit code is the CLI code on
// the final attempt, so the workflow step still fails loudly on a real defect.
import { spawnSync } from 'node:child_process';
import { classifyRailwayFailure, shouldRetry, backoffMs, MAX_ATTEMPTS } from './railway-retry';

function parseService(argv: readonly string[]): string {
  const i = argv.indexOf('--service');
  const v = i === -1 ? undefined : argv[i + 1];
  if (v === undefined || v === '') {
    throw new Error('railway-up: --service <name> is required');
  }
  return v;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function attemptOnce(service: string): { code: number; output: string } {
  const res = spawnSync('railway', ['up', '--service', service, '--ci'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  process.stdout.write(out);
  const code = res.status === null ? 1 : res.status;
  return { code, output: out };
}

function main(): number {
  const service = parseService(process.argv.slice(2));
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { code, output } = attemptOnce(service);
    if (code === 0) {
      if (attempt > 1) {
        console.log('[railway-up] ' + service + ' succeeded on attempt ' + String(attempt));
      }
      return 0;
    }
    const cls = classifyRailwayFailure(output);
    if (!shouldRetry(cls, attempt)) {
      console.error('[railway-up] ' + service + ' failed (' + cls + '), not retrying.');
      return code;
    }
    const waitMs = backoffMs(attempt);
    console.error(
      '[railway-up] ' + service + ' hit a transient fault on attempt ' + String(attempt) +
        ' of ' + String(MAX_ATTEMPTS) + ', retrying in ' + String(waitMs / 1000) + 's.',
    );
    sleepSync(waitMs);
  }
  console.error('[railway-up] ' + service + ' still failing after ' + String(MAX_ATTEMPTS) + ' attempts.');
  return 1;
}

process.exit(main());

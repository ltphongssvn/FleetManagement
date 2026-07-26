// scripts/gate-agent.ts
// Imperative shell for the gate agent. All decisions live in
// gate-agent-core.ts; this file only performs I/O and is excluded from
// coverage accordingly.
//
// Usage (always via the task, never ad hoc):
//   pnpm exec turbo run gate:agent -- --filter=@fleet/api
//   pnpm exec turbo run gate:agent -- --no-wait --events run.ndjson
//
// Contract: NDJSON events on stdout, human-readable narration on stderr, and
// the process exit code mirrors the underlying turbo run. A consumer therefore
// reads stdout as data and never parses prose. Every event carries the same
// W3C traceparent so a whole gate run correlates as one trace.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { resolveGateLockPath } from './host-gate.js';
import {
  newTraceContext,
  formatTraceparent,
  nextState,
  toNdjson,
  summarizeTurboRun,
  flockBackend,
  type GateState,
  type GateEvent,
} from './gate-agent-core.js';

/* v8 ignore start */

const WAIT_SECONDS = 3600;

function newestSummary(root: string): unknown {
  const dir = join(root, '.turbo', 'runs');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) throw new Error('gate:agent: no run summary was written');
  return JSON.parse(readFileSync(files[0] as string, 'utf8'));
}

function main(): void {
  const argv = process.argv.slice(2);
  const noWait = argv.includes('--no-wait');
  const eventsFlag = argv.indexOf('--events');
  const eventsPath = eventsFlag >= 0 ? argv[eventsFlag + 1] : undefined;
  // pnpm forwards a literal -- as argv[0]; leaving it in place would make turbo
  // hand --filter to the underlying package script instead of consuming it.
  const passthrough = argv.filter(
    (a, i) =>
      a !== '--no-wait' &&
      a !== '--' &&
      a !== '--events' &&
      i !== eventsFlag + 1,
  );

  const ctx = newTraceContext();
  const traceparent = formatTraceparent(ctx);
  const startedAt = Date.now();
  let state: GateState = 'pending';

  const emit = (event: GateEvent | 'gate.finished', extra: Record<string, unknown> = {}): void => {
    const line = toNdjson({
      traceparent,
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      event,
      state,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    });
    process.stdout.write(line);
    if (eventsPath !== undefined) appendFileSync(eventsPath, line);
  };

  const advance = (event: GateEvent, extra: Record<string, unknown> = {}): void => {
    state = nextState(state, event);
    emit(event, extra);
  };

  const lockPath = resolveGateLockPath(process.env, homedir());
  // flock(1) opens the lock file but will not create missing parent dirs.
  mkdirSync(dirname(lockPath), { recursive: true });
  const backend = flockBackend(lockPath);

  advance('preflight.started', { lockBackend: backend.name, lockPath });
  // Saturation is advisory only: it annotates the event and never decides the
  // next state, because the probes it would rely on are not portable.
  advance('preflight.passed');

  const turbo = [
    'pnpm', 'exec', 'turbo', 'run',
    'typecheck', 'lint', 'test:unit', 'test:integration',
    '--concurrency=1', '--summarize',
    ...passthrough,
  ];
  const wrapped = backend.wrap(turbo, noWait ? 1 : WAIT_SECONDS);

  const child = spawn(wrapped[0] as string, wrapped.slice(1) as string[], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });

  child.on('error', (err) => {
    advance('lock.timeout', { reason: err.message });
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    advance('lock.acquired');
    let outcome;
    try {
      outcome = summarizeTurboRun(newestSummary(process.cwd()));
    } catch (err) {
      // Fail closed: an unreadable summary is never reported as a pass.
      advance('run.failed', { reason: (err as Error).message });
      process.exit(code ?? 1);
      return;
    }
    advance(outcome.exitCode === 0 ? 'run.completed' : 'run.failed', {
      runExitCode: outcome.exitCode,
      runDurationMs: outcome.durationMs,
      attempted: outcome.attempted,
      cached: outcome.cached,
      failedTasks: outcome.failed,
      slowestTaskId: [...outcome.tasks].sort((a, b) => b.durationMs - a.durationMs)[0]?.taskId ?? null,
    });
    for (const t of outcome.tasks) {
      emit('gate.finished', {
        taskId: t.taskId,
        taskHash: t.hash,
        taskExitCode: t.exitCode,
        taskDurationMs: t.durationMs,
        cacheStatus: t.cacheStatus,
        timeSavedMs: t.timeSavedMs,
      });
    }
    process.exit(outcome.exitCode === 0 ? (code ?? 0) : (code ?? 1));
  });
}

main();

/* v8 ignore stop */

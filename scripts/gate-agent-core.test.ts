// scripts/gate-agent-core.test.ts
// RED spec for the deterministic core of the gate agent.
//
// Replaces an ad-hoc shell pipeline whose verdict came from scraping stdout
// through head/tail. Evidence gathered before writing this:
//   - turbo --summarize already emits execution.exitCode, per-task hash,
//     cache.status and cache.timeSaved as JSON; the text scrape discarded it.
//   - lsof/fuser/flock are busybox on node:22-alpine, where fuser -v prints
//     usage and flock rejects --version, so parsing host binaries is not
//     portable to the image Dockerfile.api actually builds.
//   - there was no machine-readable event an autonomous caller could consume.
// The core is pure, so every state transition is asserted directly with no I/O.
import { describe, it, expect } from 'vitest';
import {
  newTraceContext,
  formatTraceparent,
  nextState,
  toNdjson,
  summarizeTurboRun,
  flockBackend,
} from './gate-agent-core.js';

const NL = String.fromCharCode(10);

describe('trace context', () => {
  it('mints a 32-hex trace id and 16-hex span id', () => {
    const ctx = newTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
  it('never mints an all-zero id, which W3C defines as invalid', () => {
    const ctx = newTraceContext();
    expect(ctx.traceId).not.toBe('0'.repeat(32));
    expect(ctx.spanId).not.toBe('0'.repeat(16));
  });
  it('mints a distinct trace per call', () => {
    expect(newTraceContext().traceId).not.toBe(newTraceContext().traceId);
  });
  it('formats traceparent as version-trace-span-flags', () => {
    const s = formatTraceparent({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
    expect(s).toBe('00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01');
  });
  it('throws on a malformed context rather than emitting a bad header', () => {
    expect(() => formatTraceparent({ traceId: 'short', spanId: 'b'.repeat(16) })).toThrow();
  });
});

describe('nextState', () => {
  it('walks the happy path to completed', () => {
    let s = nextState('pending', 'preflight.started');
    expect(s).toBe('preflight');
    s = nextState(s, 'preflight.passed');
    expect(s).toBe('queued');
    s = nextState(s, 'lock.acquired');
    expect(s).toBe('running');
    s = nextState(s, 'run.completed');
    expect(s).toBe('completed');
  });
  it('still queues when preflight is BLOCKED: saturation is a wait, not a failure', () => {
    expect(nextState('preflight', 'preflight.blocked')).toBe('queued');
  });
  it('maps a lock timeout to aborted, kept distinct from failed', () => {
    expect(nextState('queued', 'lock.timeout')).toBe('aborted');
  });
  it('maps a run failure to failed', () => {
    expect(nextState('running', 'run.failed')).toBe('failed');
  });
  it('THROWS on an illegal transition instead of silently holding state', () => {
    expect(() => nextState('pending', 'run.completed')).toThrow();
    expect(() => nextState('completed', 'lock.acquired')).toThrow();
  });
});

describe('toNdjson', () => {
  it('emits exactly one line terminated by a newline', () => {
    const out = toNdjson({ event: 'lock.acquired', state: 'running' });
    expect(out.endsWith(NL)).toBe(true);
    expect(out.trimEnd().split(NL)).toHaveLength(1);
  });
  it('orders keys deterministically so equal events serialize identically', () => {
    const a = toNdjson({ zeta: 1, alpha: 2 });
    const b = toNdjson({ alpha: 2, zeta: 1 });
    expect(a).toBe(b);
  });
  it('refuses a value containing a raw newline, which would split the stream', () => {
    expect(() => toNdjson({ msg: 'line one' + NL + 'line two' })).toThrow();
  });
});

describe('summarizeTurboRun', () => {
  const payload = {
    execution: { exitCode: 0, attempted: 1, cached: 1, failed: 0, success: 0, startTime: 1000, endTime: 1223 },
    tasks: [
      {
        taskId: '@fleet/domain#typecheck',
        // Deliberately NOT a realistic hex digest. A 16-char hex fixture is
        // credential-shaped, so every value-based scanner flags it -- detect-secrets
        // locally and GitGuardian in CI. An allowlist pragma would silence only the
        // local one and would drift. The test asserts taskId, duration and cache
        // status, never the hash shape, so a readable placeholder loses nothing.
        hash: 'hash-fixture-domain-typecheck',
        cache: { status: 'HIT', timeSaved: 2947 },
        execution: { exitCode: 0, startTime: 1180, endTime: 1222 },
      },
    ],
  };
  it('extracts the run verdict and per-task rows', () => {
    const s = summarizeTurboRun(payload);
    expect(s.exitCode).toBe(0);
    expect(s.durationMs).toBe(223);
    expect(s.attempted).toBe(1);
    expect(s.cached).toBe(1);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].taskId).toBe('@fleet/domain#typecheck');
    expect(s.tasks[0].durationMs).toBe(42);
    expect(s.tasks[0].cacheStatus).toBe('HIT');
  });
  it('fails CLOSED on a payload with no execution block', () => {
    expect(() => summarizeTurboRun({ tasks: [] })).toThrow();
  });
  it('fails CLOSED on a non-object payload', () => {
    expect(() => summarizeTurboRun(null)).toThrow();
    expect(() => summarizeTurboRun('ok')).toThrow();
  });
});

describe('flockBackend', () => {
  // The lock is modelled as a swappable capability so a distributed backend
  // can be added for multi-HOST CI without touching the agent. flock is the
  // default because the kernel releases it on process death: no TTL, no
  // fencing token, no network -- the very failure modes a Redis lease has to
  // defend against. wrap() is pure; creating the lock directory is I/O and
  // stays in the imperative shell.
  const backend = flockBackend('/home/u/.cache/fleetmanagement/gate.lock');

  it('names itself so the emitted event records which backend ran', () => {
    expect(backend.name).toBe('flock');
  });
  it('wraps the command in file-then-command form with a wait budget', () => {
    expect(backend.wrap(['pnpm', 'exec'], 3600)).toEqual([
      'flock', '-w', '3600', '/home/u/.cache/fleetmanagement/gate.lock', 'pnpm', 'exec',
    ]);
  });
  it('never emits a bare -- separator, which flock would try to execute', () => {
    expect(backend.wrap(['pnpm'], 60)).not.toContain('--');
  });
  it('refuses to lock around an empty command', () => {
    expect(() => backend.wrap([], 60)).toThrow();
  });
  it('refuses a non-positive wait budget: a gate must never hang forever', () => {
    expect(() => backend.wrap(['pnpm'], 0)).toThrow();
  });
});

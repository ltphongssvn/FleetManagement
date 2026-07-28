// scripts/gate-agent-core.ts
// Deterministic core of the gate agent: pure functions only, zero I/O, so the
// whole decision surface is unit-testable. The imperative shell lives in
// gate-agent.ts.
//
// ROOT CAUSES THIS ELIMINATES (each verified before writing, not assumed):
//   1. VERDICT FROM TEXT. The previous flow piped run output through head/tail
//      and read the result with human eyes. turbo --summarize already writes
//      execution.exitCode, per-task hash, cache.status and cache.timeSaved to
//      .turbo/runs/<id>.json. summarizeTurboRun reads that instead, so the
//      verdict is data and the stack traces are never truncated away.
//   2. HOST BINARIES AS CONTROL FLOW. lsof, fuser and flock are util-linux on
//      this WSL host but BUSYBOX on node:22-alpine, which Dockerfile.api
//      builds from: there fuser -v prints usage and flock rejects --version.
//      Parsing them can therefore change behaviour per platform, so probe
//      output is carried as advisory attributes and never decides a state.
//   3. NO MACHINE-READABLE OUTPUT. Every step now emits one NDJSON line
//      carrying a W3C traceparent, which is the 2026 standard for propagating
//      context between agents and the piece frameworks still leave to callers.
//   4. IMPLICIT STATE. Transitions were whatever the shell happened to do
//      next. The table below is the schema: an illegal transition THROWS
//      rather than silently holding state, so impossible states cannot occur.
import { randomBytes } from 'node:crypto';

const NEWLINE = String.fromCharCode(10);

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
}

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;

// W3C trace-context forbids an all-zero id. randomBytes makes that outcome
// astronomically unlikely rather than impossible, so it is regenerated instead
// of trusted -- a gate that emits an invalid header is worse than a slow one.
export function newTraceContext(): TraceContext {
  let traceId = randomBytes(16).toString('hex');
  while (/^0+$/.test(traceId)) traceId = randomBytes(16).toString('hex');
  let spanId = randomBytes(8).toString('hex');
  while (/^0+$/.test(spanId)) spanId = randomBytes(8).toString('hex');
  return { traceId, spanId };
}

// version-traceid-spanid-flags, flags 01 = sampled.
export function formatTraceparent(ctx: TraceContext): string {
  if (!TRACE_ID_RE.test(ctx.traceId)) {
    throw new Error('formatTraceparent: traceId must be 32 lowercase hex chars');
  }
  if (!SPAN_ID_RE.test(ctx.spanId)) {
    throw new Error('formatTraceparent: spanId must be 16 lowercase hex chars');
  }
  return '00-' + ctx.traceId + '-' + ctx.spanId + '-01';
}

// A lock is a CAPABILITY, not an implementation. flock is the default because
// the kernel releases it when the holder dies: no TTL, no fencing token, no
// network round trip -- precisely the failure modes a Redis or etcd lease must
// defend against with renewal. This seam exists so a distributed backend can be
// added for multi-HOST CI without rewriting the agent. It is deliberately NOT
// added now: there is no Redis in this environment to point it at (REDIS_URL is
// unset at runtime and carries only a Zod default), and a network dependency in
// an offline developer gate would trade a working control for a fragile one.
//
// wrap() is pure and therefore tested here. Creating the lock directory is I/O
// and belongs to the imperative shell.
export interface LockBackend {
  readonly name: string;
  wrap(command: readonly string[], waitSeconds: number): readonly string[];
}

export function flockBackend(lockPath: string): LockBackend {
  return {
    name: 'flock',
    wrap(command: readonly string[], waitSeconds: number): readonly string[] {
      if (command.length === 0) {
        throw new Error('flockBackend.wrap: refusing to lock around an empty command');
      }
      if (!Number.isFinite(waitSeconds) || waitSeconds <= 0) {
        throw new Error('flockBackend.wrap: waitSeconds must be positive (a gate must never hang forever)');
      }
      // util-linux flock(1) file-then-command mode takes the command DIRECTLY
      // after the lock path. A literal -- separator is not a separator there;
      // flock tries to EXECUTE it and dies with
      //   flock: failed to execute --: No such file or directory
      return ['flock', '-w', String(waitSeconds), lockPath, ...command];
    },
  };
}

export type GateState =
  | 'pending'
  | 'preflight'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

export type GateEvent =
  | 'preflight.started'
  | 'preflight.passed'
  | 'preflight.blocked'
  | 'lock.acquired'
  | 'lock.timeout'
  | 'run.completed'
  | 'run.failed';

// The transition table IS the schema. preflight.blocked deliberately routes to
// queued, not to a failure: host saturation means WAIT FOR THE LOCK, and
// treating it as a failure is what made contention look like broken tests.
// lock.timeout maps to aborted, kept distinct from failed, so an autonomous
// caller can retry a starved gate without misreporting a red build.
const TRANSITIONS: Readonly<Record<GateState, Partial<Record<GateEvent, GateState>>>> = {
  pending: { 'preflight.started': 'preflight' },
  preflight: {
    'preflight.passed': 'queued',
    'preflight.blocked': 'queued',
  },
  queued: { 'lock.acquired': 'running', 'lock.timeout': 'aborted' },
  running: { 'run.completed': 'completed', 'run.failed': 'failed' },
  completed: {},
  failed: {},
  aborted: {},
};

export function nextState(state: GateState, event: GateEvent): GateState {
  // TRANSITIONS is a TOTAL Record over GateState, so the outer lookup is never
  // nullish; only the inner event lookup can miss. An optional chain here would
  // be dead code that hides that guarantee.
  const target = TRANSITIONS[state][event];
  if (target === undefined) {
    throw new Error('nextState: illegal transition ' + state + ' --> ' + event);
  }
  return target;
}

// One event per line. Keys are sorted so two equal events serialize to
// byte-identical lines, which lets a consumer diff or dedupe them. A raw
// newline inside a value would split one event across two lines and silently
// corrupt the stream, so it is rejected at the boundary rather than escaped.
export function toNdjson(payload: Readonly<Record<string, unknown>>): string {
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.includes(NEWLINE)) {
      throw new Error('toNdjson: value for ' + key + ' contains a raw newline');
    }
  }
  const ordered = Object.keys(payload).sort();
  return JSON.stringify(payload, ordered) + NEWLINE;
}

export interface TaskOutcome {
  readonly taskId: string;
  readonly hash: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly cacheStatus: string;
  readonly timeSavedMs: number;
}

export interface RunOutcome {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly attempted: number;
  readonly cached: number;
  readonly failed: number;
  readonly tasks: readonly TaskOutcome[];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('summarizeTurboRun: ' + label + ' is not an object');
  }
  return value as Record<string, unknown>;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Fails CLOSED: a malformed or truncated summary throws rather than defaulting
// to exitCode 0. A verdict inferred from missing data is exactly the silent
// pass this agent exists to prevent.
export function summarizeTurboRun(payload: unknown): RunOutcome {
  const root = asRecord(payload, 'payload');
  if (root['execution'] === undefined) {
    throw new Error('summarizeTurboRun: payload has no execution block');
  }
  const execution = asRecord(root['execution'], 'execution');
  const rawTasks = Array.isArray(root['tasks']) ? (root['tasks'] as unknown[]) : [];

  const tasks: TaskOutcome[] = rawTasks.map((entry, index) => {
    const task = asRecord(entry, 'tasks[' + String(index) + ']');
    const taskExec = asRecord(task['execution'] ?? {}, 'task execution');
    const cache = asRecord(task['cache'] ?? {}, 'task cache');
    return {
      taskId: typeof task['taskId'] === 'string' ? task['taskId'] : 'unknown',
      hash: typeof task['hash'] === 'string' ? task['hash'] : 'unknown',
      exitCode: num(taskExec['exitCode'], -1),
      durationMs: num(taskExec['endTime'], 0) - num(taskExec['startTime'], 0),
      cacheStatus: typeof cache['status'] === 'string' ? cache['status'] : 'unknown',
      timeSavedMs: num(cache['timeSaved'], 0),
    };
  });

  return {
    exitCode: num(execution['exitCode'], -1),
    durationMs: num(execution['endTime'], 0) - num(execution['startTime'], 0),
    attempted: num(execution['attempted'], 0),
    cached: num(execution['cached'], 0),
    failed: num(execution['failed'], 0),
    tasks,
  };
}

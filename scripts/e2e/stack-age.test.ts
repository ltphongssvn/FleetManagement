// scripts/e2e/stack-age.test.ts
// RED (t86 stack-age-reaper arc, 2026-08-05): age classification for RUNNING
// fleet compose stacks.
//
// WHY THIS EXISTS. docker:reclaim can stop idle stacks, but nothing makes an
// idle stack VISIBLE. Seven containers ran for hours at 46% CPU -- localstack
// polling s3.ListBuckets every six seconds -- and were found only because a
// human screenshotted Docker Desktop. A reclaim tool nobody knows to run is
// not a control.
//
// WHY AGE, NOT PROCESS LIFETIME. The 2026 answer for ephemeral test stacks is a
// reaper bound to the spawning process (Ryuk), which tears down even on
// abnormal exit. That does NOT fit here: stack:up is DELIBERATELY long-lived,
// held open for manual browser verification, so binding its lifetime to the
// spawner would destroy its purpose. Reaping RUNNING containers by max age is
// the recognised separate concept, and of its enumerated implementations --
// host script, docker events subscription, or baking it into the app that
// spawns them -- this is the third: the spawner is already a registered
// TypeScript task, so no sidecar, no privileged container, no daemon.
//
// WHY docker inspect AND NOT docker ps / compose ps. The compose json CreatedAt
// field emits "2026-08-05 06:02:26 +0000 UTC", which Date cannot parse
// reliably. That is a known unfixed defect (docker/compose #12520, which
// proposes reformatting it as RFC3339Nano). RunningFor is human prose
// ("2 hours ago") -- the message-matching treadmill this codebase has already
// removed twice. docker inspect emits real RFC3339.
//
// WHY StartedAt AND NOT CreatedAt. A restarted container has a fresh working
// life; its creation time does not reflect how long it has been holding RAM.
//
// NANOSECONDS, NOT MILLISECONDS. Docker emits RFC3339Nano -- nine fractional
// digits -- e.g. 2021-05-07T17:27:52.347500403Z, and podman emits the same
// precision with a numeric offset, 2021-05-07T13:28:21.783776413-04:00. A
// schema pinned to three digits and a Z would reject genuine docker output and
// classify every stack fresh: a confident zero produced by the measurement.
import { describe, it, expect } from 'vitest';
import {
  classifyStackAge,
  inspectStartedAtArgs,
  oldestStartedAt,
  psIdsArgsForProject,
  STACK_AGE_EXIT,
  stackAgeExitCode,
  startedAtSchema,
} from './stack-age.js';
const NL = String.fromCharCode(10);
const NOW = new Date('2026-08-05T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
describe('startedAtSchema (docker output is a trust boundary)', () => {
  it('accepts the RFC3339Nano form docker actually emits (9 fractional digits)', () => {
    expect(startedAtSchema.safeParse('2021-05-07T17:27:52.347500403Z').success).toBe(true);
  });
  it('accepts the podman form: nanoseconds with a numeric offset', () => {
    expect(startedAtSchema.safeParse('2021-05-07T13:28:21.783776413-04:00').success).toBe(true);
  });
  it('accepts millisecond precision too, so the schema is not over-pinned', () => {
    expect(startedAtSchema.safeParse('2026-08-05T06:02:26.217Z').success).toBe(true);
  });
  it('accepts a whole-second timestamp with no fractional part', () => {
    expect(startedAtSchema.safeParse('2024-03-15T09:45:12Z').success).toBe(true);
  });
  it('REJECTS the compose CreatedAt form, a known unfixed docker defect', () => {
    expect(
      startedAtSchema.safeParse('2026-08-05 06:02:26 +0000 UTC').success,
      'accepting an unparseable timestamp yields NaN ages and classifies everything fresh',
    ).toBe(false);
  });
  it('REJECTS human prose like RunningFor', () => {
    expect(startedAtSchema.safeParse('2 hours ago').success).toBe(false);
  });
  it('REJECTS an empty string rather than treating it as the epoch', () => {
    expect(startedAtSchema.safeParse('').success).toBe(false);
  });
});
describe('oldestStartedAt (a stack is as old as its oldest container)', () => {
  it('returns the earliest timestamp from several containers', () => {
    expect(oldestStartedAt([hoursAgo(1), hoursAgo(9), hoursAgo(3)].join(NL))).toBe(hoursAgo(9));
  });
  it('handles a single container', () => {
    expect(oldestStartedAt(hoursAgo(2))).toBe(hoursAgo(2));
  });
  it('ignores blank lines rather than parsing them as dates', () => {
    expect(oldestStartedAt([hoursAgo(4), '', '  ', hoursAgo(2)].join(NL))).toBe(hoursAgo(4));
  });
  it('THROWS on a malformed line: a broken read must never look like a fresh stack', () => {
    expect(
      () => oldestStartedAt(['2 hours ago', hoursAgo(1)].join(NL)),
      'silently skipping an unparseable timestamp would understate the age of the stack',
    ).toThrow();
  });
  it('returns null when there are no containers at all', () => {
    expect(oldestStartedAt('')).toBe(null);
  });
});
describe('classifyStackAge (fresh / idle / stale)', () => {
  const base = { project: 'fleet-pilot', now: NOW, ttlHours: 2 };
  it('classifies a just-started stack as fresh', () => {
    expect(classifyStackAge({ ...base, startedAt: hoursAgo(0.5) }).kind).toBe('fresh');
  });
  it('classifies a stack at exactly the TTL as fresh, not idle', () => {
    expect(
      classifyStackAge({ ...base, startedAt: hoursAgo(2) }).kind,
      'the boundary belongs to fresh so a session running exactly to the limit is not nagged',
    ).toBe('fresh');
  });
  it('classifies a stack past the TTL as idle', () => {
    const r = classifyStackAge({ ...base, startedAt: hoursAgo(3) });
    expect(r.kind).toBe('idle');
    expect(r.kind === 'idle' && Math.round(r.ageHours)).toBe(3);
  });
  it('classifies a stack past four times the TTL as stale', () => {
    expect(
      classifyStackAge({ ...base, startedAt: hoursAgo(20) }).kind,
      'an overnight leak is a different problem from a long session and must read differently',
    ).toBe('stale');
  });
  it('reports the project name so the report is actionable', () => {
    expect(classifyStackAge({ ...base, startedAt: hoursAgo(9) }).project).toBe('fleet-pilot');
  });
  it('treats a stack with no containers as fresh: nothing is holding RAM', () => {
    expect(classifyStackAge({ ...base, startedAt: null }).kind).toBe('fresh');
  });
  it('THROWS on a non-positive ttl rather than classifying everything idle', () => {
    expect(() => classifyStackAge({ ...base, ttlHours: 0, startedAt: hoursAgo(1) })).toThrow();
  });
});
describe('argv planners (one place for each docker invocation)', () => {
  it('lists container ids by the compose project LABEL, never by name parsing', () => {
    const args = psIdsArgsForProject('fleet-pilot');
    expect(args).toContain('--filter');
    expect(args.join(' ')).toContain('label=com.docker.compose.project=fleet-pilot');
    expect(
      args.join(' ').includes('{{.Names}}'),
      'container names break on hyphenated services like ops-web and mock-oauth2; labels are what compose sets',
    ).toBe(false);
  });
  it('inspects StartedAt, never CreatedAt', () => {
    const args = inspectStartedAtArgs(['abc123', 'def456']);
    expect(args.join(' ')).toContain('.State.StartedAt');
    expect(args.join(' ').includes('.Created')).toBe(false);
    expect(args).toContain('abc123');
    expect(args).toContain('def456');
  });
  it('never passes a mutating docker verb', () => {
    const all = [...psIdsArgsForProject('p'), ...inspectStartedAtArgs(['x'])].join(' ');
    expect(all.includes(' rm')).toBe(false);
    expect(all.includes('stop')).toBe(false);
    expect(all.includes('prune')).toBe(false);
  });
});
describe('stackAgeExitCode (gates, does not merely print)', () => {
  it('is 0 when every stack is fresh', () => {
    expect(stackAgeExitCode({ fresh: 3, idle: 0, stale: 0 })).toBe(STACK_AGE_EXIT.ok);
  });
  it('is 0 when nothing is running at all', () => {
    expect(stackAgeExitCode({ fresh: 0, idle: 0, stale: 0 })).toBe(STACK_AGE_EXIT.ok);
  });
  it('reports idle with its own code', () => {
    expect(stackAgeExitCode({ fresh: 1, idle: 1, stale: 0 })).toBe(STACK_AGE_EXIT.idle);
  });
  it('lets STALE dominate idle: an overnight leak outranks a long session', () => {
    expect(stackAgeExitCode({ fresh: 0, idle: 2, stale: 1 })).toBe(STACK_AGE_EXIT.stale);
  });
  it('keeps every code distinct so the operator can branch on it', () => {
    const codes = Object.values(STACK_AGE_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('reserves 2 for usage, per the universal CLI convention', () => {
    expect(STACK_AGE_EXIT.usage).toBe(2);
  });
});

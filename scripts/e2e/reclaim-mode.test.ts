// scripts/e2e/reclaim-mode.test.ts
// RED (t86 stack-age-reaper arc, 2026-08-05): argv parsing and report
// formatting for docker:reclaim --report.
//
// WHY --report AND NOT A NEW TASK. docker:reclaim already discovers every
// running fleet project; asking a second task to re-derive that would give two
// answers to one question, which is the duplication this codebase keeps
// removing. Age is a new DIMENSION of the same reading, not a new reading.
//
// WHY ADDITIVE, NEVER A CHANGE OF DEFAULT. The default must stay
// stop-everything so every existing invocation keeps its meaning -- including
// the one that reclaimed 16.1GB an hour ago. A flag that silently converted a
// reclaim into a survey would be the worst possible regression here: the
// operator would believe the host was freed while seven containers held RAM,
// which is the precise failure stack:stop already committed once.
//
// This mirrors deps:reconcile's shape, with the polarity deliberately
// inverted: there, WRITING needed opt-in because writing was dangerous; here,
// READING is the opt-in because the existing default already acts and changing
// that would be the danger.
import { describe, expect, it } from 'vitest';
import { formatAgeReport, parseReclaimArgv, summarizeStackAges } from './reclaim-mode.js';
import { classifyStackAge, STACK_AGE_EXIT, type StackAge } from './stack-age.js';
const NOW = new Date('2026-08-05T12:00:00.000Z');
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const age = (project: string, h: number | null, ttlHours = 2): StackAge =>
  classifyStackAge({
    project,
    startedAt: h === null ? null : hoursAgo(h),
    now: NOW,
    ttlHours,
  });
describe('parseReclaimArgv (default behaviour must not change)', () => {
  it('DEFAULTS to reclaiming, exactly as before this flag existed', () => {
    expect(
      parseReclaimArgv([]).report,
      'an existing invocation must keep stopping stacks; silently turning a reclaim into a survey would leave RAM held while reporting success',
    ).toBe(false);
  });
  it('reads --report as an opt-in survey', () => {
    expect(parseReclaimArgv(['--report']).report).toBe(true);
  });
  it('does NOT treat an unrelated known flag as report mode', () => {
    expect(parseReclaimArgv(['--ttl-hours', '4']).report).toBe(false);
  });
  it('defaults the ttl to two hours', () => {
    expect(parseReclaimArgv([]).ttlHours).toBe(2);
  });
  it('accepts an explicit ttl', () => {
    expect(parseReclaimArgv(['--ttl-hours', '6']).ttlHours).toBe(6);
  });
  it('THROWS on an unknown flag rather than silently ignoring it', () => {
    expect(
      () => parseReclaimArgv(['--reprot']),
      'a swallowed --report typo would STOP every stack the operator meant only to inspect',
    ).toThrow();
  });
  it('THROWS on a non-numeric ttl rather than falling back to a default', () => {
    expect(() => parseReclaimArgv(['--ttl-hours', 'soon'])).toThrow();
  });
  it('THROWS on a zero or negative ttl, which would mark every stack idle', () => {
    expect(() => parseReclaimArgv(['--ttl-hours', '0'])).toThrow();
    expect(() => parseReclaimArgv(['--ttl-hours', '-3'])).toThrow();
  });
});
describe('summarizeStackAges (counts drive the exit code)', () => {
  it('counts an all-fresh host as fresh only', () => {
    const s = summarizeStackAges([age('fleet-a', 0.5), age('fleet-b', 1)]);
    expect(s).toEqual({ fresh: 2, idle: 0, stale: 0 });
  });
  it('separates idle from stale', () => {
    const s = summarizeStackAges([age('fleet-a', 3), age('fleet-b', 30)]);
    expect(s).toEqual({ fresh: 0, idle: 1, stale: 1 });
  });
  it('is all zeroes for an empty host', () => {
    expect(summarizeStackAges([])).toEqual({ fresh: 0, idle: 0, stale: 0 });
  });
});
describe('formatAgeReport (the report must be actionable, not a count)', () => {
  it('names every project and its state', () => {
    const text = formatAgeReport([age('fleet-pilot', 9), age('fleet-abc', 0.5)]).join(' ');
    expect(text).toContain('fleet-pilot');
    expect(text).toContain('fleet-abc');
  });
  it('shows the age in hours for a non-fresh stack', () => {
    const text = formatAgeReport([age('fleet-pilot', 9)]).join(' ');
    expect(
      text,
      'a bare IDLE label makes the operator run another command to learn how bad it is',
    ).toMatch(/9(\.\d+)?h/);
  });
  it('names the remedy, so the report does not require prior knowledge', () => {
    const text = formatAgeReport([age('fleet-pilot', 9)]).join(' ');
    expect(text).toContain('docker:reclaim');
  });
  it('says plainly when nothing is idle', () => {
    const text = formatAgeReport([age('fleet-a', 0.5)])
      .join(' ')
      .toLowerCase();
    expect(text).toContain('fresh');
  });
  it('produces one line per project plus no hidden state', () => {
    expect(formatAgeReport([age('fleet-a', 1), age('fleet-b', 5)]).length).toBe(2);
  });
  it('reports an empty host without inventing a line', () => {
    expect(formatAgeReport([])).toEqual([]);
  });
});
describe('report mode integrates with the graded exit vocabulary', () => {
  it('a stale stack must surface as the stale exit code', () => {
    const s = summarizeStackAges([age('fleet-pilot', 30)]);
    expect(s.stale).toBe(1);
    expect(STACK_AGE_EXIT.stale).not.toBe(STACK_AGE_EXIT.ok);
  });
});

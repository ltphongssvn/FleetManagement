// apps/driver-app/test/assignment-action-policy.test.ts
// TDD RED: nextDriverAction maps a road_run state to the single action a
// driver may take next. One action at a time keeps the driver UI simple.
import { describe, it, expect } from 'vitest';
import { nextDriverAction } from '../src/assignments/assignment-action-policy.js';

describe('nextDriverAction', () => {
  it('planned -> accept', () => {
    const a = nextDriverAction('planned');
    expect(a).toEqual({ kind: 'accept', label: 'Nhận lệnh' });
  });

  it('dispatched -> start', () => {
    const a = nextDriverAction('dispatched');
    expect(a).toEqual({ kind: 'start', label: 'Bắt đầu chuyến' });
  });

  it('started -> complete', () => {
    const a = nextDriverAction('started');
    expect(a).toEqual({ kind: 'complete', label: 'Hoàn thành' });
  });

  it('completed -> no action (terminal)', () => {
    expect(nextDriverAction('completed')).toEqual({ kind: 'none' });
  });

  it('unknown state -> no action', () => {
    expect(nextDriverAction('something-else')).toEqual({ kind: 'none' });
  });

  it('is case-insensitive on the state string', () => {
    expect(nextDriverAction('PLANNED').kind).toBe('accept');
  });
});

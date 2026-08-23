// apps/owner-app/test/adoption-presenter.test.ts
// RED: pure presenter mapping OwnerAdoptionMetrics -> the owner dashboard
// view-model (Vietnamese card labels + an adoption percentage). No native
// deps, so unit-covered. Vietnamese UI strings are immutable contract.
import { describe, it, expect } from 'vitest';
import { presentAdoption, ADOPTION_LABELS } from '../src/dashboard/adoption-presenter.js';
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';

const base: OwnerAdoptionMetrics = {
  totalDrivers: 5,
  deviceRegistered: 4,
  appInstalled: 3,
  activeToday: 2,
  notInstalled: 2,
  asOf: '2026-07-06T08:00:00.000Z',
  day: '2026-07-06',
};

describe('presentAdoption', () => {
  it('exposes the headline installed / total figures', () => {
    const vm = presentAdoption(base);
    expect(vm.appInstalled).toBe(3);
    expect(vm.totalDrivers).toBe(5);
    expect(vm.notInstalled).toBe(2);
  });

  it('computes the adoption percentage (installed / total, rounded)', () => {
    expect(presentAdoption(base).installedPct).toBe(60);
    expect(presentAdoption({ ...base, totalDrivers: 3, appInstalled: 1 }).installedPct).toBe(33);
  });

  it('reports 0% adoption without dividing by zero on an empty roster', () => {
    const vm = presentAdoption({
      ...base,
      totalDrivers: 0,
      deviceRegistered: 0,
      appInstalled: 0,
      activeToday: 0,
      notInstalled: 0,
    });
    expect(vm.installedPct).toBe(0);
  });

  it('builds ordered funnel rows with Vietnamese labels and values', () => {
    const rows = presentAdoption(base).rows;
    expect(rows.map((r) => r.label)).toEqual([
      ADOPTION_LABELS.totalDrivers,
      ADOPTION_LABELS.appInstalled,
      ADOPTION_LABELS.notInstalled,
      ADOPTION_LABELS.activeToday,
    ]);
    expect(rows.map((r) => r.value)).toEqual([5, 3, 2, 2]);
  });

  it('surfaces the VN day for the active-today window', () => {
    expect(presentAdoption(base).day).toBe('2026-07-06');
  });

  it('keeps the Vietnamese labels immutable and non-empty', () => {
    for (const label of Object.values(ADOPTION_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(ADOPTION_LABELS.notInstalled).toContain('Chưa');
  });
});

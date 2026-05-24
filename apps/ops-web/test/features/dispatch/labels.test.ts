// apps/ops-web/test/features/dispatch/labels.test.ts
// L1a unit RED: pure label-formatting functions for the dispatch board.
// No React, no fetch — just deterministic transforms. Drives the labels.ts
// module that DispatchBoard will import in the next RED→GREEN step.
import { describe, it, expect } from 'vitest';
import {
  formatOrderRef,
  formatOperator,
  formatVehicle,
  buildLookup,
} from '@/features/dispatch/labels';
const DRIVER_UUID = '00000000-0000-0000-0000-0000000000bb';
const VEHICLE_UUID = '22222222-2222-4222-8222-222222222222';
describe('formatOrderRef — dispatcher-entered Số lệnh is the primary key', () => {
  it('returns the first transport order ref verbatim when present', () => {
    expect(formatOrderRef(['XT.0067'])).toBe('XT.0067');
  });
  it('returns the first ref even when several are joined to one road run', () => {
    expect(formatOrderRef(['XT.0067', 'XT.0068'])).toBe('XT.0067');
  });
  it('falls back to em-dash when no refs exist (system-generated road run)', () => {
    expect(formatOrderRef([])).toBe('—');
  });
  it('treats a whitespace-only ref as missing', () => {
    expect(formatOrderRef(['   '])).toBe('—');
  });
});
describe('buildLookup — id→label map from reference items', () => {
  it('produces a Map keyed by id with label values', () => {
    const lookup = buildLookup([
      { id: DRIVER_UUID, label: 'Nguyễn Văn A' },
      { id: 'other', label: 'Other' },
    ]);
    expect(lookup.get(DRIVER_UUID)).toBe('Nguyễn Văn A');
    expect(lookup.get('other')).toBe('Other');
  });
  it('returns an empty Map for an empty input (safe for first render)', () => {
    expect(buildLookup([]).size).toBe(0);
  });
});
describe('formatOperator — UUID → driver display name', () => {
  it('resolves a known operator id to its label', () => {
    const lookup = buildLookup([{ id: DRIVER_UUID, label: 'Nguyễn Văn A' }]);
    expect(formatOperator(DRIVER_UUID, lookup)).toBe('Nguyễn Văn A');
  });
  it('returns em-dash for a null operator id (unassigned road run)', () => {
    expect(formatOperator(null, buildLookup([]))).toBe('—');
  });
  it('never leaks a raw UUID when the id is unknown — falls back to em-dash', () => {
    // Critical invariant: dispatcher must never see opaque UUIDs in the table.
    expect(formatOperator(DRIVER_UUID, buildLookup([]))).toBe('—');
  });
});
describe('formatVehicle — UUID → plate', () => {
  it('resolves a known vehicle id to its plate label', () => {
    const lookup = buildLookup([{ id: VEHICLE_UUID, label: '51C-12345' }]);
    expect(formatVehicle(VEHICLE_UUID, lookup)).toBe('51C-12345');
  });
  it('returns em-dash for a null vehicle id', () => {
    expect(formatVehicle(null, buildLookup([]))).toBe('—');
  });
  it('never leaks a raw UUID when the id is unknown', () => {
    expect(formatVehicle(VEHICLE_UUID, buildLookup([]))).toBe('—');
  });
});

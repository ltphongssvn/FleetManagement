// apps/driver-app/test/manifest-capture-stop.test.ts
// L1 RED for the pure stop-descriptor parser. Drives the business invariant:
//   - 1..4 loading warehouses (stopIndex 0..3, displayed as 1..4)
//   - exactly 1 unloading warehouse (no stopIndex required)
//   - any out-of-range / missing / malformed input is rejected with a typed
//     rejection code so the screen can render a localized error
import { describe, it, expect } from 'vitest';
import {
  parseCaptureStop,
  MAX_LOADING_WAREHOUSES,
  type CaptureStop,
  type CaptureStopRejectionCode,
} from '../src/manifest/manifest-capture-stop.js';

describe('parseCaptureStop (multi-warehouse business invariant)', () => {
  it('accepts loading stopIndex=0 as loading warehouse #1', () => {
    const result = parseCaptureStop({ stopKind: 'loading', stopIndex: '0' });
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('unreachable');
    const stop: CaptureStop = result.stop;
    expect(stop.kind).toBe('loading');
    if (stop.kind !== 'loading') throw new Error('unreachable');
    expect(stop.stopIndex).toBe(0);
    expect(stop.displayIndex).toBe(1);
  });

  it('accepts loading stopIndex=3 as loading warehouse #4 (max)', () => {
    const result = parseCaptureStop({ stopKind: 'loading', stopIndex: '3' });
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('unreachable');
    if (result.stop.kind !== 'loading') throw new Error('unreachable');
    expect(result.stop.stopIndex).toBe(3);
    expect(result.stop.displayIndex).toBe(4);
  });

  it('rejects loading stopIndex=4 (above MAX_LOADING_WAREHOUSES)', () => {
    expect(MAX_LOADING_WAREHOUSES).toBe(4);
    const result = parseCaptureStop({ stopKind: 'loading', stopIndex: '4' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    const code: CaptureStopRejectionCode = result.rejectionCode;
    expect(code).toBe('loading_index_out_of_range');
  });

  it('rejects loading stopIndex=-1 (negative)', () => {
    const result = parseCaptureStop({ stopKind: 'loading', stopIndex: '-1' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.rejectionCode).toBe('loading_index_out_of_range');
  });

  it('rejects loading without stopIndex', () => {
    const result = parseCaptureStop({ stopKind: 'loading' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.rejectionCode).toBe('loading_index_missing');
  });

  it('rejects loading with non-integer stopIndex', () => {
    const result = parseCaptureStop({ stopKind: 'loading', stopIndex: '1.5' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.rejectionCode).toBe('loading_index_invalid');
  });

  it('rejects loading with non-numeric stopIndex', () => {
    const result = parseCaptureStop({ stopKind: 'loading', stopIndex: 'abc' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.rejectionCode).toBe('loading_index_invalid');
  });

  it('accepts unloading without stopIndex (single unloading warehouse)', () => {
    const result = parseCaptureStop({ stopKind: 'unloading' });
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('unreachable');
    expect(result.stop.kind).toBe('unloading');
  });

  it('accepts unloading and ignores any stopIndex (only one unloading warehouse)', () => {
    const result = parseCaptureStop({ stopKind: 'unloading', stopIndex: '7' });
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('unreachable');
    expect(result.stop.kind).toBe('unloading');
  });

  it('rejects missing stopKind', () => {
    const result = parseCaptureStop({});
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.rejectionCode).toBe('stop_kind_missing');
  });

  it('rejects unknown stopKind', () => {
    const result = parseCaptureStop({ stopKind: 'transit' });
    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error('unreachable');
    expect(result.rejectionCode).toBe('stop_kind_invalid');
  });
});

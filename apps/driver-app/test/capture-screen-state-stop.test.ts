// apps/driver-app/test/capture-screen-state-stop.test.ts
// L2 RED: extend the capture screen-state machine to be aware of the multi-
// warehouse stop descriptor. The state machine must:
//   - start in 'idle' carrying a CaptureStop (loading 1..4 or unloading)
//   - remember the stop across PICKED / UPLOAD_START / UPLOAD_OK transitions
//   - expose a parse-rejection start state when the stop params are invalid
//     so the presenter can render a localized error without a capture button
import { describe, it, expect } from 'vitest';
import {
  initialCaptureStateForStop,
  reduceCapture,
  type CaptureState,
} from '../src/manifest/capture-screen-state.js';

describe('capture screen-state with stop descriptor', () => {
  it('initial state for a loading stop is idle and carries the stop', () => {
    const s = initialCaptureStateForStop({
      accepted: true,
      stop: { kind: 'loading', stopIndex: 0, displayIndex: 1 },
    });
    expect(s.phase).toBe('idle');
    if (s.phase !== 'idle') throw new Error('unreachable');
    expect(s.stop.kind).toBe('loading');
    if (s.stop.kind !== 'loading') throw new Error('unreachable');
    expect(s.stop.displayIndex).toBe(1);
  });

  it('initial state for an unloading stop is idle and carries the stop', () => {
    const s = initialCaptureStateForStop({
      accepted: true,
      stop: { kind: 'unloading' },
    });
    expect(s.phase).toBe('idle');
    if (s.phase !== 'idle') throw new Error('unreachable');
    expect(s.stop.kind).toBe('unloading');
  });

  it('initial state for a rejected parse is invalid_stop with the rejection code', () => {
    const s = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'loading_index_out_of_range',
    });
    expect(s.phase).toBe('invalid_stop');
    if (s.phase !== 'invalid_stop') throw new Error('unreachable');
    expect(s.rejectionCode).toBe('loading_index_out_of_range');
  });

  it('reducer preserves the stop across PICKED -> UPLOAD_START -> UPLOAD_OK', () => {
    const s0: CaptureState = initialCaptureStateForStop({
      accepted: true,
      stop: { kind: 'loading', stopIndex: 2, displayIndex: 3 },
    });
    const s1 = reduceCapture(s0, {
      type: 'PICKED',
      file: { mimeType: 'image/jpeg', sizeBytes: 50_000 },
      localUri: 'file:///tmp/a.jpg',
    });
    expect(s1.phase).toBe('spooled');
    if (s1.phase !== 'spooled') throw new Error('unreachable');
    expect(s1.stop.kind).toBe('loading');
    if (s1.stop.kind !== 'loading') throw new Error('unreachable');
    expect(s1.stop.displayIndex).toBe(3);

    const s2 = reduceCapture(s1, { type: 'UPLOAD_START' });
    expect(s2.phase).toBe('uploading');
    if (s2.phase !== 'uploading') throw new Error('unreachable');
    expect(s2.stop.kind).toBe('loading');

    const s3 = reduceCapture(s2, {
      type: 'UPLOAD_OK',
      manifestId: '11111111-1111-1111-1111-111111111111',
    });
    expect(s3.phase).toBe('done');
    if (s3.phase !== 'done') throw new Error('unreachable');
    expect(s3.stop.kind).toBe('loading');
  });

  it('reducer ignores PICKED when state is invalid_stop (no capture allowed)', () => {
    const s0: CaptureState = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'stop_kind_missing',
    });
    const s1 = reduceCapture(s0, {
      type: 'PICKED',
      file: { mimeType: 'image/jpeg', sizeBytes: 50_000 },
      localUri: 'file:///tmp/a.jpg',
    });
    expect(s1.phase).toBe('invalid_stop');
  });
});

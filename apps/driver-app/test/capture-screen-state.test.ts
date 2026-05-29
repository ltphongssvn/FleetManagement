// apps/driver-app/test/capture-screen-state.test.ts
// TDD RED: pure state machine for the manifest-capture screen.
// Drives: idle -> picked -> validating -> spooled -> uploading -> done | error.
// No native deps so the screen logic is testable without a device.
import { describe, it, expect } from 'vitest';
import {
  initialCaptureState,
  reduceCapture,
  type CaptureState,
} from '../src/manifest/capture-screen-state.js';

const okFile = { mimeType: 'image/jpeg', sizeBytes: 50_000 };

describe('capture-screen-state', () => {
  it('starts idle', () => {
    expect(initialCaptureState().phase).toBe('idle');
  });

  it('idle + PICKED valid file -> validating then spooled', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: okFile, localUri: 'file:///m.jpg' });
    expect(s.phase).toBe('spooled');
    if (s.phase === 'spooled') {
      expect(s.localUri).toBe('file:///m.jpg');
      expect(s.mimeType).toBe('image/jpeg');
    }
  });

  it('idle + PICKED oversize file -> error with rejection code', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: { mimeType: 'image/jpeg', sizeBytes: 99_999_999 }, localUri: 'file:///big.jpg' });
    expect(s.phase).toBe('error');
    if (s.phase === 'error') expect(s.rejectionCode).toBe('too_large');
  });

  it('idle + PICKED bad mime -> error invalid_mime', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: { mimeType: 'text/plain', sizeBytes: 5000 }, localUri: 'file:///x.txt' });
    expect(s.phase).toBe('error');
    if (s.phase === 'error') expect(s.rejectionCode).toBe('invalid_mime');
  });

  it('spooled + UPLOAD_START -> uploading', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: okFile, localUri: 'file:///m.jpg' });
    s = reduceCapture(s, { type: 'UPLOAD_START' });
    expect(s.phase).toBe('uploading');
  });

  it('uploading + UPLOAD_OK -> done with manifestId', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: okFile, localUri: 'file:///m.jpg' });
    s = reduceCapture(s, { type: 'UPLOAD_START' });
    s = reduceCapture(s, { type: 'UPLOAD_OK', manifestId: 'm-1' });
    expect(s.phase).toBe('done');
    if (s.phase === 'done') expect(s.manifestId).toBe('m-1');
  });

  it('uploading + UPLOAD_FAIL -> error with message, retryable', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: okFile, localUri: 'file:///m.jpg' });
    s = reduceCapture(s, { type: 'UPLOAD_START' });
    s = reduceCapture(s, { type: 'UPLOAD_FAIL', message: 'network down' });
    expect(s.phase).toBe('error');
    if (s.phase === 'error') {
      expect(s.message).toMatch(/network down/);
      expect(s.retryable).toBe(true);
    }
  });

  it('error + RESET -> idle', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: { mimeType: 'text/plain', sizeBytes: 5000 }, localUri: 'file:///x.txt' });
    s = reduceCapture(s, { type: 'RESET' });
    expect(s.phase).toBe('idle');
  });

  it('ignores UPLOAD_OK when not uploading (guards illegal transition from idle)', () => {
    let s: CaptureState = initialCaptureState();
    const before = s.phase;
    s = reduceCapture(s, { type: 'UPLOAD_OK', manifestId: 'x' });
    expect(s.phase).toBe(before);
  });

  it('ignores UPLOAD_OK when in spooled (not uploading) - covers guard return', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: okFile, localUri: 'file:///m.jpg' });
    expect(s.phase).toBe('spooled');
    s = reduceCapture(s, { type: 'UPLOAD_OK', manifestId: 'nope' });
    expect(s.phase).toBe('spooled');
  });

  it('ignores UPLOAD_FAIL when not uploading - covers guard return', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'PICKED', file: okFile, localUri: 'file:///m.jpg' });
    expect(s.phase).toBe('spooled');
    s = reduceCapture(s, { type: 'UPLOAD_FAIL', message: 'irrelevant' });
    expect(s.phase).toBe('spooled');
  });

  it('ignores UPLOAD_FAIL from idle - covers guard return', () => {
    let s: CaptureState = initialCaptureState();
    s = reduceCapture(s, { type: 'UPLOAD_FAIL', message: 'irrelevant' });
    expect(s.phase).toBe('idle');
  });
});

// apps/driver-app/test/capture-screen-presenter.test.ts
// TDD RED: pure presenter mapping CaptureState -> view-model the screen
// renders. No native deps; lets the screen stay a thin shell over tested
// logic (same split as sync-status-presenter / commands-screen-state).
import { describe, it, expect } from 'vitest';
import { presentCapture } from '../src/manifest/capture-screen-presenter.js';
import {
  initialCaptureState,
  reduceCapture,
  type CaptureState,
} from '../src/manifest/capture-screen-state.js';

const ok = { mimeType: 'image/jpeg', sizeBytes: 50_000 };
function spooled(): CaptureState {
  return reduceCapture(initialCaptureState(), {
    type: 'PICKED',
    file: ok,
    localUri: 'file:///m.jpg',
  });
}

describe('capture-screen-presenter', () => {
  it('idle: prompts to take photo, capture enabled, upload hidden', () => {
    const v = presentCapture(initialCaptureState());
    expect(v.testID).toBe('capture-idle');
    expect(v.title).toMatch(/Phiếu giao hàng/i);
    expect(v.captureButton.visible).toBe(true);
    expect(v.captureButton.disabled).toBe(false);
    expect(v.uploadButton.visible).toBe(false);
    expect(v.busy).toBe(false);
  });

  it('spooled: shows preview, upload enabled, capture relabeled to retake', () => {
    const v = presentCapture(spooled());
    expect(v.testID).toBe('capture-spooled');
    expect(v.previewUri).toBe('file:///m.jpg');
    expect(v.uploadButton.visible).toBe(true);
    expect(v.uploadButton.disabled).toBe(false);
    expect(v.captureButton.label).toMatch(/Chụp lại/i);
    expect(v.busy).toBe(false);
  });

  it('uploading: busy spinner, both buttons disabled', () => {
    let s = spooled();
    s = reduceCapture(s, { type: 'UPLOAD_START' });
    const v = presentCapture(s);
    expect(v.testID).toBe('capture-uploading');
    expect(v.busy).toBe(true);
    expect(v.captureButton.disabled).toBe(true);
    expect(v.uploadButton.disabled).toBe(true);
    expect(v.statusText).toMatch(/Đang tải ảnh/i);
  });

  it('done: success message, only reset visible', () => {
    let s = spooled();
    s = reduceCapture(s, { type: 'UPLOAD_START' });
    s = reduceCapture(s, { type: 'UPLOAD_OK', manifestId: 'm-9' });
    const v = presentCapture(s);
    expect(v.testID).toBe('capture-done');
    expect(v.statusText).toMatch(/Tải lên thành công/i);
    expect(v.resetButton.visible).toBe(true);
    expect(v.captureButton.visible).toBe(false);
    expect(v.uploadButton.visible).toBe(false);
  });

  it('error (validation): shows rejection message + reset', () => {
    const s = reduceCapture(initialCaptureState(), {
      type: 'PICKED',
      file: { mimeType: 'text/plain', sizeBytes: 9 },
      localUri: 'file:///x',
    });
    const v = presentCapture(s);
    expect(v.testID).toBe('capture-error');
    expect(v.statusText).toMatch(/không hợp lệ|invalid_mime/i);
    expect(v.resetButton.visible).toBe(true);
  });

  it('error (upload fail): shows message and retry-capable reset', () => {
    let s = spooled();
    s = reduceCapture(s, { type: 'UPLOAD_START' });
    s = reduceCapture(s, { type: 'UPLOAD_FAIL', message: 'network down' });
    const v = presentCapture(s);
    expect(v.testID).toBe('capture-error');
    expect(v.statusText).toMatch(/network down/);
    expect(v.resetButton.visible).toBe(true);
  });
});

// apps/driver-app/test/capture-screen-presenter-stop.test.ts
// L3 RED: presenter must localize the title and status to the multi-warehouse
// stop descriptor:
//   - loading stop #N -> title 'Phiếu nhận hàng - Kho nhận hàng N'
//   - unloading stop  -> title 'Phiếu giao hàng - Kho dỡ hàng'
//   - invalid_stop    -> error testID, localized message per rejectionCode,
//                        no capture button visible
import { describe, it, expect } from 'vitest';
import { presentCapture } from '../src/manifest/capture-screen-presenter.js';
import {
  initialCaptureStateForStop,
  type CaptureState,
} from '../src/manifest/capture-screen-state.js';

describe('presentCapture with multi-warehouse stop', () => {
  it('loading stop #1 renders loading-manifest title for warehouse 1', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: true,
      stop: { kind: 'loading', stopIndex: 0, displayIndex: 1, stopSequence: null },
    });
    const vm = presentCapture(state);
    expect(vm.title).toBe('Phiếu nhận hàng - Kho nhận hàng 1');
    expect(vm.stopKind).toBe('loading');
    expect(vm.stopDisplayIndex).toBe(1);
    expect(vm.captureButton.visible).toBe(true);
  });

  it('loading stop #4 renders loading-manifest title for warehouse 4', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: true,
      stop: { kind: 'loading', stopIndex: 3, displayIndex: 4, stopSequence: null },
    });
    const vm = presentCapture(state);
    expect(vm.title).toBe('Phiếu nhận hàng - Kho nhận hàng 4');
    expect(vm.stopKind).toBe('loading');
    expect(vm.stopDisplayIndex).toBe(4);
  });

  it('unloading stop renders delivery-receipt title at the unloading warehouse', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: true,
      stop: { kind: 'unloading', stopSequence: null },
    });
    const vm = presentCapture(state);
    expect(vm.title).toBe('Phiếu giao hàng - Kho dỡ hàng');
    expect(vm.stopKind).toBe('unloading');
    expect(vm.stopDisplayIndex).toBeNull();
  });

  it('invalid_stop (loading_index_out_of_range) renders an error view with no capture button', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'loading_index_out_of_range',
    });
    const vm = presentCapture(state);
    expect(vm.testID).toBe('capture-invalid-stop');
    expect(vm.statusText).toMatch(/Kho nhận hàng không hợp lệ/);
    expect(vm.captureButton.visible).toBe(false);
    expect(vm.uploadButton.visible).toBe(false);
  });

  it('invalid_stop (stop_kind_missing) renders a localized missing-stop message', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'stop_kind_missing',
    });
    const vm = presentCapture(state);
    expect(vm.testID).toBe('capture-invalid-stop');
    expect(vm.statusText).toMatch(/Thiếu thông tin điểm dừng/);
    expect(vm.captureButton.visible).toBe(false);
  });

  it('invalid_stop (stop_kind_invalid) renders a localized invalid-kind message', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'stop_kind_invalid',
    });
    const vm = presentCapture(state);
    expect(vm.testID).toBe('capture-invalid-stop');
    expect(vm.statusText).toMatch(/Loại điểm dừng không hợp lệ/);
  });

  it('invalid_stop (loading_index_missing) renders a localized missing-index message', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'loading_index_missing',
    });
    const vm = presentCapture(state);
    expect(vm.statusText).toMatch(/Thiếu số thứ tự kho nhận hàng/);
  });

  it('invalid_stop (loading_index_invalid) renders a localized invalid-index message', () => {
    const state: CaptureState = initialCaptureStateForStop({
      accepted: false,
      rejectionCode: 'loading_index_invalid',
    });
    const vm = presentCapture(state);
    expect(vm.statusText).toMatch(/Số thứ tự kho nhận hàng không hợp lệ/);
  });
});

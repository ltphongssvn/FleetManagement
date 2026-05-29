// apps/driver-app/src/manifest/capture-screen-presenter.ts
// Pure presenter: CaptureState -> view-model the capture screen renders.
// No native deps. Vietnamese UI (drivers operate in VN).
//
// Multi-warehouse business invariant rendering:
//   - loading stop #N -> 'Phiếu nhận hàng - Kho nhận hàng N'
//   - unloading stop  -> 'Phiếu giao hàng - Kho dỡ hàng'
//   - invalid_stop    -> localized error per rejection code, no capture button
import type { CaptureState } from './capture-screen-state.js';
import type { CaptureStop, CaptureStopRejectionCode } from './manifest-capture-stop.js';

export interface ButtonVM {
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly label: string;
}

export interface CaptureViewModel {
  readonly testID: string;
  readonly title: string;
  readonly statusText: string;
  readonly previewUri: string | null;
  readonly busy: boolean;
  readonly stopKind: 'loading' | 'unloading' | null;
  readonly stopDisplayIndex: number | null;
  readonly captureButton: ButtonVM;
  readonly uploadButton: ButtonVM;
  readonly resetButton: ButtonVM;
}

const HIDDEN_CAPTURE: ButtonVM = { visible: false, disabled: true, label: 'Chụp ảnh' };
const HIDDEN_UPLOAD: ButtonVM = { visible: false, disabled: true, label: 'Tải lên' };
const HIDDEN_RESET: ButtonVM = { visible: false, disabled: true, label: 'Làm lại' };

function titleForStop(stop: CaptureStop): string {
  if (stop.kind === 'unloading') return 'Phiếu giao hàng - Kho dỡ hàng';
  return 'Phiếu nhận hàng - Kho nhận hàng ' + String(stop.displayIndex);
}

function statusIdleForStop(stop: CaptureStop): string {
  if (stop.kind === 'unloading') {
    return 'Chụp ảnh phiếu giao hàng tại kho dỡ hàng sau khi dỡ hàng xong.';
  }
  return 'Chụp ảnh phiếu nhận hàng tại kho nhận hàng ' + String(stop.displayIndex) + ' sau khi nhận hàng xong.';
}

function stopKindOf(stop: CaptureStop): 'loading' | 'unloading' {
  return stop.kind;
}

function stopDisplayIndexOf(stop: CaptureStop): number | null {
  return stop.kind === 'loading' ? stop.displayIndex : null;
}

const INVALID_STOP_MESSAGES: Record<CaptureStopRejectionCode, string> = {
  stop_kind_missing: 'Thiếu thông tin điểm dừng. Vui lòng quay lại danh sách lệnh điều xe.',
  stop_kind_invalid: 'Loại điểm dừng không hợp lệ.',
  loading_index_missing: 'Thiếu số thứ tự kho nhận hàng.',
  loading_index_invalid: 'Số thứ tự kho nhận hàng không hợp lệ.',
  loading_index_out_of_range: 'Kho nhận hàng không hợp lệ (tối đa 4 kho nhận hàng mỗi chuyến).',
};

export function presentCapture(state: CaptureState): CaptureViewModel {
  if (state.phase === 'invalid_stop') {
    return {
      testID: 'capture-invalid-stop',
      title: 'Không thể chụp ảnh',
      statusText: INVALID_STOP_MESSAGES[state.rejectionCode],
      previewUri: null,
      busy: false,
      stopKind: null,
      stopDisplayIndex: null,
      captureButton: HIDDEN_CAPTURE,
      uploadButton: HIDDEN_UPLOAD,
      resetButton: HIDDEN_RESET,
    };
  }
  const title = titleForStop(state.stop);
  const stopKind = stopKindOf(state.stop);
  const stopDisplayIndex = stopDisplayIndexOf(state.stop);
  switch (state.phase) {
    case 'idle':
      return {
        testID: 'capture-idle',
        title,
        statusText: statusIdleForStop(state.stop),
        previewUri: null,
        busy: false,
        stopKind,
        stopDisplayIndex,
        captureButton: { visible: true, disabled: false, label: 'Chụp ảnh' },
        uploadButton: HIDDEN_UPLOAD,
        resetButton: HIDDEN_RESET,
      };
    case 'spooled':
      return {
        testID: 'capture-spooled',
        title,
        statusText: 'Ảnh đã sẵn sàng. Nhấn Tải lên để gửi.',
        previewUri: state.localUri,
        busy: false,
        stopKind,
        stopDisplayIndex,
        captureButton: { visible: true, disabled: false, label: 'Chụp lại' },
        uploadButton: { visible: true, disabled: false, label: 'Tải lên' },
        resetButton: HIDDEN_RESET,
      };
    case 'uploading':
      return {
        testID: 'capture-uploading',
        title,
        statusText: 'Đang tải ảnh lên…',
        previewUri: state.localUri,
        busy: true,
        stopKind,
        stopDisplayIndex,
        captureButton: { visible: true, disabled: true, label: 'Chụp lại' },
        uploadButton: { visible: true, disabled: true, label: 'Đang tải…' },
        resetButton: HIDDEN_RESET,
      };
    case 'done':
      return {
        testID: 'capture-done',
        title,
        statusText: 'Tải lên thành công.',
        previewUri: null,
        busy: false,
        stopKind,
        stopDisplayIndex,
        captureButton: HIDDEN_CAPTURE,
        uploadButton: HIDDEN_UPLOAD,
        resetButton: { visible: true, disabled: false, label: 'Chụp phiếu khác' },
      };
    case 'error':
      return {
        testID: 'capture-error',
        title,
        statusText: state.message,
        previewUri: null,
        busy: false,
        stopKind,
        stopDisplayIndex,
        captureButton: HIDDEN_CAPTURE,
        uploadButton: HIDDEN_UPLOAD,
        resetButton: { visible: true, disabled: false, label: 'Thử lại' },
      };
  }
}

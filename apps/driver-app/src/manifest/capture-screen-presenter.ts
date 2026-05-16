// apps/driver-app/src/manifest/capture-screen-presenter.ts
// Pure presenter: CaptureState -> view-model the capture screen renders.
// No native deps. Keeps the screen a thin shell over tested logic, same
// split as sync-status-presenter / commands-screen-state. Vietnamese UI
// (drivers operate in VN).
import type { CaptureState } from './capture-screen-state.js';

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
  readonly captureButton: ButtonVM;
  readonly uploadButton: ButtonVM;
  readonly resetButton: ButtonVM;
}

const TITLE = 'Chụp ảnh phiếu giao hàng';

export function presentCapture(state: CaptureState): CaptureViewModel {
  switch (state.phase) {
    case 'idle':
      return {
        testID: 'capture-idle',
        title: TITLE,
        statusText: 'Chụp ảnh phiếu sau khi giao hàng xong.',
        previewUri: null,
        busy: false,
        captureButton: { visible: true, disabled: false, label: 'Chụp ảnh' },
        uploadButton: { visible: false, disabled: true, label: 'Tải lên' },
        resetButton: { visible: false, disabled: true, label: 'Làm lại' },
      };
    case 'spooled':
      return {
        testID: 'capture-spooled',
        title: TITLE,
        statusText: 'Ảnh đã sẵn sàng. Nhấn Tải lên để gửi.',
        previewUri: state.localUri,
        busy: false,
        captureButton: { visible: true, disabled: false, label: 'Chụp lại' },
        uploadButton: { visible: true, disabled: false, label: 'Tải lên' },
        resetButton: { visible: false, disabled: true, label: 'Làm lại' },
      };
    case 'uploading':
      return {
        testID: 'capture-uploading',
        title: TITLE,
        statusText: 'Đang tải ảnh lên…',
        previewUri: state.localUri,
        busy: true,
        captureButton: { visible: true, disabled: true, label: 'Chụp lại' },
        uploadButton: { visible: true, disabled: true, label: 'Đang tải…' },
        resetButton: { visible: false, disabled: true, label: 'Làm lại' },
      };
    case 'done':
      return {
        testID: 'capture-done',
        title: TITLE,
        statusText: 'Tải lên thành công.',
        previewUri: null,
        busy: false,
        captureButton: { visible: false, disabled: true, label: 'Chụp ảnh' },
        uploadButton: { visible: false, disabled: true, label: 'Tải lên' },
        resetButton: { visible: true, disabled: false, label: 'Chụp phiếu khác' },
      };
    case 'error':
      return {
        testID: 'capture-error',
        title: TITLE,
        statusText: state.message,
        previewUri: null,
        busy: false,
        captureButton: { visible: false, disabled: true, label: 'Chụp ảnh' },
        uploadButton: { visible: false, disabled: true, label: 'Tải lên' },
        resetButton: { visible: true, disabled: false, label: 'Thử lại' },
      };
  }
}

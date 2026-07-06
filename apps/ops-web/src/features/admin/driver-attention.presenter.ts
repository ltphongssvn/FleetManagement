// apps/ops-web/src/features/admin/driver-attention.presenter.ts
// Driver-attention presenter: machine-readable reason codes -> immutable
// Vietnamese copy + next-action hint. Two-tier discipline (same as
// login-error.ts / vnExceptionMessage): input is a LOOSE string so an older
// UI never crashes on a newer producer code (generic fallback instead);
// the strict Record over DriverAttentionReason makes every CONTRACT code a
// compile-time obligation -- adding a code to @fleet/sync-protocol without
// a label here fails typecheck. Labels are presentation, codes are
// contract: the table strings Chua giao / Chua dang ky stay byte-identical
// to their pre-existing JSX values; hints name the real controls on the
// admin drivers page. Vietnamese UI strings are immutable contracts.
import type { DriverAttentionReason } from '@fleet/sync-protocol';

export interface DriverAttentionPresentation {
  readonly label: string;
  readonly hint: string;
}

/** Queue section heading -- immutable Vietnamese contract. */
export const DRIVER_ATTENTION_QUEUE_HEADING = 'Cần xử lý';

/** Generic presentation for codes this build does not know. */
export const DRIVER_ATTENTION_FALLBACK: DriverAttentionPresentation =
  Object.freeze({
    label: 'Cần kiểm tra',
    hint: 'Vui lòng kiểm tra thông tin tài xế.',
  });

const PRESENTATIONS: Record<DriverAttentionReason, DriverAttentionPresentation> =
  Object.freeze({
    VEHICLE_UNASSIGNED: Object.freeze({
      label: 'Chưa giao',
      hint: 'Chọn số xe và bấm Phân công & đăng ký.',
    }),
    DEVICE_UNREGISTERED: Object.freeze({
      label: 'Chưa đăng ký',
      hint: 'Nhập mã thiết bị (UDID) và bấm Phân công & đăng ký.',
    }),
  });

function isKnownReason(code: string): code is DriverAttentionReason {
  return Object.prototype.hasOwnProperty.call(PRESENTATIONS, code);
}

/** Loose in, immutable Vietnamese out; unknown -> generic fallback. */
export function presentDriverAttentionReason(
  code: string,
): DriverAttentionPresentation {
  return isKnownReason(code) ? PRESENTATIONS[code] : DRIVER_ATTENTION_FALLBACK;
}

/** Order-preserving list presentation; empty stays empty. */
export function presentDriverAttentionReasons(
  codes: readonly string[],
): readonly DriverAttentionPresentation[] {
  return codes.map(presentDriverAttentionReason);
}

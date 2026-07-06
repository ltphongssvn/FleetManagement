// apps/driver-app/src/errors/present-api-error.ts
// The ONE function between any thrown error and driver-visible text. Every
// screen renders presentApiError(err, <its context fallback>) instead of
// err.message, which makes the raw "POST <url> HTTP 400" banner structurally
// impossible: no branch of this function can ever return transport text.
// Policy: mapped code -> immutable Vietnamese copy with next-step guidance
// (strict FleetErrorCode union keys the Record, so adding a code to the
// contract forces a message here at typecheck time -- the login-error.ts
// house pattern); ApiError without a mapped code -> status-class fallback;
// anything else -> the caller''s context fallback (default: shared generic).
// Unknown future codes deliberately fall to the status class instead of
// echoing the code: a driver must never see a machine token.
// Vietnamese strings are immutable contracts, asserted verbatim in tests.
import { FleetErrorCodeSchema, type FleetErrorCode } from '@fleet/sync-protocol';
import { ApiError } from './api-error.js';

export const VN_ERROR_MESSAGES: Readonly<Record<FleetErrorCode, string>> = {
  VALIDATION_FAILED: 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại thông tin.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu. Vui lòng tải lại danh sách.',
  INVALID_STATE_TRANSITION: 'Không thể hoàn thành chuyến. Vui lòng kiểm tra trạng thái đơn.',
  MANIFESTS_INCOMPLETE: 'Chưa thể hoàn thành chuyến: chưa chụp đủ ảnh phiếu cân. Vui lòng chụp đủ ảnh tại các điểm lấy và giao hàng.',
  INTERNAL: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.',
};

export const VN_STATUS_FALLBACKS = {
  notFound: 'Không tìm thấy dữ liệu. Vui lòng tải lại danh sách.',
  clientError: 'Không thể thực hiện yêu cầu. Vui lòng kiểm tra và thử lại.',
  serverError: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.',
} as const;

export const VN_GENERIC_ERROR = 'Đã xảy ra lỗi. Vui lòng thử lại.';

export function presentApiError(err: unknown, fallback: string = VN_GENERIC_ERROR): string {
  if (err instanceof ApiError) {
    if (err.code !== undefined) {
      const parsed = FleetErrorCodeSchema.safeParse(err.code);
      if (parsed.success) return VN_ERROR_MESSAGES[parsed.data];
    }
    if (err.status === 404) return VN_STATUS_FALLBACKS.notFound;
    if (err.status >= 500) return VN_STATUS_FALLBACKS.serverError;
    if (err.status >= 400) return VN_STATUS_FALLBACKS.clientError;
  }
  return fallback;
}

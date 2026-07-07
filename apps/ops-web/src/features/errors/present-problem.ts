// apps/ops-web/src/features/errors/present-problem.ts
// ops-web presentation seam: pure mapping from an api error response
// (status + already-parsed body) to friendly dispatcher Vietnamese with
// next-step guidance. Server actions call this at their !res.ok branch and
// return the result in their existing message field, so forms keep rendering
// result.message unchanged while raw transport text ("API request failed:
// 500 ...") becomes structurally unreachable. Generalizes the
// login-error.ts house pattern: the copy Record is keyed by the strict
// FleetErrorCode union (adding a contract code forces copy here at typecheck
// time); unknown future codes and non-envelope bodies fall to the status
// class -- a dispatcher never sees a machine token; out-of-range statuses
// fall to the caller''s context fallback (default: shared generic).
// Vietnamese strings are immutable contracts, asserted verbatim in tests.
import {
  parseProblemDetails,
  FleetErrorCodeSchema,
  type FleetErrorCode,
} from '@fleet/sync-protocol';

export const VN_OPS_ERROR_MESSAGES: Readonly<Record<FleetErrorCode, string>> = {
  VALIDATION_FAILED: 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại các trường đã nhập.',
  UNAUTHORIZED: 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu. Vui lòng tải lại danh sách.',
  INVALID_STATE_TRANSITION: 'Không thể thực hiện: trạng thái đơn đã thay đổi. Vui lòng tải lại danh sách.',
  MANIFESTS_INCOMPLETE: 'Chưa thể hoàn thành chuyến: chưa đủ ảnh phiếu cân tại các điểm.',
  INTERNAL: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.',
};

export const VN_OPS_STATUS_FALLBACKS = {
  notFound: 'Không tìm thấy dữ liệu. Vui lòng tải lại danh sách.',
  clientError: 'Không thể thực hiện yêu cầu. Vui lòng kiểm tra và thử lại.',
  serverError: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.',
} as const;

export const VN_OPS_GENERIC_ERROR = 'Đã xảy ra lỗi. Vui lòng thử lại.';

export function vnApiErrorMessage(
  status: number,
  body: unknown,
  fallback: string = VN_OPS_GENERIC_ERROR,
): string {
  const problem = parseProblemDetails(body);
  if (problem?.code !== undefined) {
    const parsed = FleetErrorCodeSchema.safeParse(problem.code);
    if (parsed.success) return VN_OPS_ERROR_MESSAGES[parsed.data];
  }
  if (status === 404) return VN_OPS_STATUS_FALLBACKS.notFound;
  if (status >= 500 && status <= 599) return VN_OPS_STATUS_FALLBACKS.serverError;
  if (status >= 400) return VN_OPS_STATUS_FALLBACKS.clientError;
  return fallback;
}
/** Present a caught exception (admin client throws, unexpected failures)
 * without ever rendering its raw message. Admin clients today throw
 * Error('<status> <text>')-style messages; a leading 3-digit HTTP status maps
 * through the status-class rules, everything else gets the caller''s fixed
 * copy -- raw exception text is structurally unreachable. */
export function vnExceptionMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    const m = /^(\d{3})\b/.exec(e.message);
    if (m !== null) return vnApiErrorMessage(Number(m[1]), undefined, fallback);
  }
  return fallback;
}

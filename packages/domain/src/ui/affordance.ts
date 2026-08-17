// packages/domain/src/ui/affordance.ts
// SSOT for the T70 UI AFFORDANCE vocabulary: how prominent an action is, why a
// region is empty, and what help a surface offers.
//
// Root cause this closes: every ops-web screen hand-rolled interactive markup
// with ad hoc Tailwind classes, so affordance, disclosure and guidance were
// re-decided per file and were ABSENT wherever the author did not think of
// them. Users then reported that they cannot tell what is clickable, what a
// symbol means, or what to do next. Naming the vocabulary ONCE in the domain --
// and typing every label map as a Record over the enum -- makes an unlabelled
// or unnamed affordance a COMPILE error rather than a screen-by-screen repair.
//
// 2026 practice encoded here:
//   WCAG 2.5.8 Target Size (Minimum), AA -- 24x24 CSS px floor, exported as a
//     contract constant so a primitive cannot ship a smaller hit area.
//   WCAG 3.2.6 Consistent Help, A -- HELP_TOPICS is the closed set of surfaces
//     that expose a help mechanism, so the shell can place it in the SAME
//     relative position on every one of them.
//   WCAG 1.4.1 Use of Colour -- tone is a NAMED role, never a raw colour, so a
//     danger action cannot be conveyed by redness alone downstream.
//   Affordance practice -- an empty region must state WHY it is empty and what
//     to do next, so every EMPTY_STATE_VI entry carries a title AND a hint.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tone: the MEANING of an action. Escalation order, least to most consequential.
// Deliberately orthogonal to emphasis below: tone answers what happens, emphasis
// answers how loudly it is presented. Collapsing the two is what produced the
// grey Xoa (delete) text link sitting at the same weight as Luu SDT (save).
// ---------------------------------------------------------------------------
export const ACTION_TONES = Object.freeze([
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
] as const);

export const ActionToneSchema = z.enum(ACTION_TONES);

export type ActionTone = z.infer<typeof ActionToneSchema>;

// ---------------------------------------------------------------------------
// Emphasis: the VISUAL WEIGHT of an action, heaviest first. A danger action can
// be solid (the confirm button inside a destructive dialog) or ghost (a row
// action in a dense table); a primary action is solid exactly once per surface.
// ---------------------------------------------------------------------------
export const ACTION_EMPHASES = Object.freeze([
  'solid',
  'soft',
  'ghost',
] as const);

export const ActionEmphasisSchema = z.enum(ACTION_EMPHASES);

export type ActionEmphasis = z.infer<typeof ActionEmphasisSchema>;

// ---------------------------------------------------------------------------
// Empty-state reason: WHY a region has nothing in it. The four meanings the UI
// previously collapsed into a single em-dash (no data, no match, not
// applicable, not yet arrived) are now distinct, because the remedy differs:
// create something, clear the search, ignore it, or wait.
// ---------------------------------------------------------------------------
export const EMPTY_STATE_REASONS = Object.freeze([
  'no_data_yet',
  'no_search_results',
  'no_filter_results',
  'not_applicable',
  'awaiting_upstream',
] as const);

export const EmptyStateReasonSchema = z.enum(EMPTY_STATE_REASONS);

export type EmptyStateReason = z.infer<typeof EmptyStateReasonSchema>;

// Copy for an empty region: what the user is looking at, and what to do next.
// A title without a hint is the dead-end sentence this arc exists to remove.
export interface EmptyStateCopy {
  readonly title: string;
  readonly hint: string;
}

// Record<EmptyStateReason, EmptyStateCopy> -- adding a reason above without
// adding copy here fails typecheck, so an unexplained empty region cannot ship.
export const EMPTY_STATE_VI: Record<EmptyStateReason, EmptyStateCopy> = Object.freeze({
  no_data_yet: {
    title: 'Chưa có lệnh điều xe nào',
    hint: 'Bấm nút Tạo lệnh điều xe để tạo lệnh đầu tiên.',
  },
  no_search_results: {
    title: 'Không tìm thấy kết quả nào',
    hint: 'Thử từ khóa ngắn hơn, hoặc xóa ô tìm kiếm để xem lại toàn bộ danh sách.',
  },
  no_filter_results: {
    title: 'Không có mục nào trong mục lọc này',
    hint: 'Chọn thẻ lọc khác ở phía trên để xem các mục còn lại.',
  },
  not_applicable: {
    title: 'Không áp dụng',
    hint: 'Mục này không có trong lệnh điều xe hiện tại nên không cần nhập.',
  },
  awaiting_upstream: {
    title: 'Đang chờ dữ liệu',
    hint: 'Hệ thống đang xử lý. Dữ liệu sẽ tự hiện ra, không cần tải lại trang.',
  },
});

// ---------------------------------------------------------------------------
// Help topics: the closed set of surfaces that expose a help mechanism. Closed
// on purpose -- WCAG 3.2.6 requires consistent PLACEMENT, and a consistent
// placement is only enforceable when the set of places is enumerable.
// ---------------------------------------------------------------------------
export const HELP_TOPICS = Object.freeze([
  'dispatch_board',
  'create_order',
  'order_detail',
  'database_admin',
  'driver_assignments',
  'owner_dashboard',
] as const);

export const HelpTopicSchema = z.enum(HELP_TOPICS);

export type HelpTopic = z.infer<typeof HelpTopicSchema>;

// Help copy is a title plus ordered, concrete steps. Steps -- not a paragraph --
// because the complaint is that users do not know what to DO; prose restates
// what the screen is, a step list names the next action.
export interface HelpTopicCopy {
  readonly title: string;
  readonly steps: readonly string[];
}

export const HELP_TOPIC_VI: Record<HelpTopic, HelpTopicCopy> = Object.freeze({
  dispatch_board: {
    title: 'Bảng điều phối dùng để làm gì',
    steps: [
      'Bảng này liệt kê các lệnh điều xe. Bấm Số lệnh để mở chi tiết một lệnh.',
      'Dùng ba thẻ Đang chạy, Đã hoàn tất, Lệnh Hủy để lọc nhanh theo tình trạng.',
      'Gõ vào ô tìm kiếm rồi nhấn Enter để tìm theo bất kỳ thông tin nào.',
      'Bấm Tạo lệnh điều xe ở góc phải để tạo lệnh mới.',
    ],
  },
  create_order: {
    title: 'Cách tạo một lệnh điều xe',
    steps: [
      'Chọn ngày điều xe, sau đó chọn số xe. Tài xế đi kèm xe sẽ tự điền.',
      'Chọn tên hàng và khách hàng.',
      'Chọn kho nhận hàng và ngày nhận. Bấm Thêm kho nhận hàng nếu có nhiều điểm.',
      'Chọn kho giao hàng và ngày giao, rồi bấm Tạo lệnh.',
    ],
  },
  order_detail: {
    title: 'Màn hình chi tiết đơn vận chuyển',
    steps: [
      'Phần trên là thông tin lệnh: xe, tài xế, khách hàng và tình trạng.',
      'Phần Các điểm dừng cho biết tài xế đã tới từng kho hay chưa.',
      'Chỉ hủy được lệnh khi tài xế chưa nhận phiếu cân và chưa bắt đầu chạy.',
    ],
  },
  database_admin: {
    title: 'Cơ sở dữ liệu dùng để làm gì',
    steps: [
      'Trang này quản lý tài xế, xe, khách hàng, tên hàng và kho.',
      'Dùng thanh mục lục ở đầu trang để nhảy thẳng tới đúng bảng.',
      'Mục Cần xử lý ở trên cùng là các tài xế còn thiếu xe hoặc thiếu thiết bị.',
      'Mỗi dòng có nút thao tác riêng; nút màu đỏ là thao tác xóa, cần xác nhận.',
    ],
  },
  driver_assignments: {
    title: 'Ứng dụng tài xế dùng thế nào',
    steps: [
      'Màn hình đầu tiên là các chuyến được giao cho bạn hôm nay.',
      'Bấm vào một chuyến để xem các điểm nhận hàng và kho giao hàng.',
      'Tới kho thì chụp phiếu cân; ảnh sẽ tự gửi khi có mạng.',
    ],
  },
  owner_dashboard: {
    title: 'Bảng theo dõi của chủ xe',
    steps: [
      'Bảng này cho biết bao nhiêu tài xế đã cài và đang dùng ứng dụng.',
      'Các con số tự cập nhật, không cần thao tác gì thêm.',
    ],
  },
});

// ---------------------------------------------------------------------------
// WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA: an interactive target is at
// least 24x24 CSS px, or is spaced so a 24px circle centred on it intersects no
// other target. Exported as a contract constant so the primitive layer asserts
// against the SPEC value rather than a hard-coded literal per component.
// ---------------------------------------------------------------------------
export const MIN_TARGET_SIZE_PX = 24;

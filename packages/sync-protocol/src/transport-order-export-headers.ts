// packages/sync-protocol/src/transport-order-export-headers.ts
// SSOT (provider-owned contract) for the Lệnh điều xe Excel export header row.
//
// 2026 contract-first: the exported workbook column set is a CONTRACT, so it lives
// in exactly one place and every consumer imports it — the apps/api export service
// that WRITES the header, its integration test, and the top-level e2e acceptance
// spec that READS the downloaded workbook. Before this module the array was copied
// into all three; the copies drifted (the Chênh lệch column was added to the
// service + package tests but not the e2e spec, which only fails on the push-event
// Playwright job — invisible to the PR gate). Importing this one definition makes
// that drift structurally impossible.
//
// Shape: 6 identifying columns + Chênh lệch (the pickup-vs-delivery weight diff),
// then a (warehouse NAME, net-weight kg NUMBER) PAIR per stop slot — pickup slots
// 1..4 then delivery slot 1 — giving 17 columns. Mirrors board-stops.tsx slot order.

/** Pickup stop slots shown on the board, in order (1..4). */
export const EXPORT_PICKUP_SLOTS = [1, 2, 3, 4] as const;
/** Delivery stop slots shown on the board, in order (1). */
export const EXPORT_DELIVERY_SLOTS = [1] as const;
/** Suffix appended to a slot name column to form its paired kg-number column. */
export const EXPORT_KG_SUFFIX = ' - KL (kg)';

/** The 6 fixed identifying columns + Chênh lệch, before the per-slot pairs. */
export const EXPORT_IDENTIFYING_HEADERS = [
  'Số lệnh', 'Trạng thái', 'Khách hàng', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm', 'Chênh lệch (Số giao - Số nhận)',
] as const;

/** SSOT: the complete export header row, in order. Derived so a slot-count change
 *  updates every consumer (service, integration test, e2e spec) from one place. */
export const LENH_DIEU_XE_EXPORT_HEADERS: readonly string[] = [
  ...EXPORT_IDENTIFYING_HEADERS,
  ...EXPORT_PICKUP_SLOTS.flatMap((n) => ['Điểm nhận hàng ' + String(n), 'Điểm nhận hàng ' + String(n) + EXPORT_KG_SUFFIX]),
  ...EXPORT_DELIVERY_SLOTS.flatMap((n) => ['Kho giao hàng ' + String(n), 'Kho giao hàng ' + String(n) + EXPORT_KG_SUFFIX]),
];

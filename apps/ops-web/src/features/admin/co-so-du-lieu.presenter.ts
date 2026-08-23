// apps/ops-web/src/features/admin/co-so-du-lieu.presenter.ts
// Cơ sở dữ liệu driver-status presenter: the three-state badge SSOT code
// (@fleet/sync-protocol DriverDbStatus) -> immutable Vietnamese label + a
// semantic badge tone the table maps to colour. Two-tier discipline (same as
// driver-attention.presenter / login-error): input is a LOOSE string so an
// older UI never crashes on a newer producer code (generic fallback instead),
// while the strict Record over DriverDbStatus makes every CONTRACT code a
// compile-time obligation -- adding a status to @fleet/sync-protocol without a
// label here fails typecheck. Labels + tones are presentation; the codes are
// contract. Vietnamese UI strings are immutable contracts.
import type { DriverDbStatus } from '@fleet/sync-protocol';

// Semantic badge tone; the table layer maps each to its colour classes. Kept as
// a string union (presentation concern) rather than a runtime schema.
export type DriverDbStatusTone = 'warning' | 'info' | 'success' | 'neutral';

export interface DriverDbStatusPresentation {
  readonly label: string;
  readonly tone: DriverDbStatusTone;
}

// Generic presentation for codes this build does not know.
export const DRIVER_DB_STATUS_FALLBACK: DriverDbStatusPresentation = Object.freeze({
  label: 'Không rõ',
  tone: 'neutral',
});

const PRESENTATIONS: Record<DriverDbStatus, DriverDbStatusPresentation> = Object.freeze({
  unassigned: Object.freeze({ label: 'Chưa phân công', tone: 'warning' }),
  assigned: Object.freeze({ label: 'Đã giao xe', tone: 'info' }),
  active: Object.freeze({ label: 'Đang hoạt động', tone: 'success' }),
});

function isKnownStatus(code: string): code is DriverDbStatus {
  return Object.prototype.hasOwnProperty.call(PRESENTATIONS, code);
}

// Loose in, immutable Vietnamese out; unknown -> generic fallback.
export function presentDriverDbStatus(code: string): DriverDbStatusPresentation {
  return isKnownStatus(code) ? PRESENTATIONS[code] : DRIVER_DB_STATUS_FALLBACK;
}

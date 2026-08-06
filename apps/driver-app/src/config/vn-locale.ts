// apps/driver-app/src/config/vn-locale.ts
// Centralized VN locale/timezone formatting. Backend runs on Railway
// (US/SG region); drivers + dispatchers operate in Vietnam. Server emits
// UTC ISO timestamps; the UI must always render in Asia/Ho_Chi_Minh
// (UTC+7) with vi-VN conventions, independent of device tz/locale.
import { formatVnDate as formatVnDateShared } from '@fleet/sync-protocol';
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;
export const VN_LOCALE = 'vi-VN' as const;

const FALLBACK = '—';

function toDate(input: string | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatVnDateTime(input: string | Date): string {
  const d = toDate(input);
  if (d === null) return FALLBACK;
  return new Intl.DateTimeFormat(VN_LOCALE, {
    timeZone: VN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatVnDate(input: string | Date): string {
  const d = toDate(input);
  if (d === null) return FALLBACK;
  return new Intl.DateTimeFormat(VN_LOCALE, {
    timeZone: VN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Assignment dates for the driver. DELEGATES to the shared
// @fleet/sync-protocol formatter so a driver at a weighbridge sees exactly
// what the dispatcher sees on the board.
//
// The US suffix in this name is now a MISNOMER kept deliberately for one
// step. The body used to build its own en-US formatter with month: short,
// which printed May 30, 2026 into a Vietnamese-only app. Renaming the export
// and changing its behaviour in the same commit would make any regression
// ambiguous between the two, so the rename is a separate mechanical
// follow-up; the call site in app/(app)/assignments.tsx is unchanged here.
//
// The local formatVnDate above is retained because it is a DIFFERENT shape
// (2-digit day/month via the driver-app config) used elsewhere in this app;
// consolidating the whole file onto the contract is tracked separately.
export function formatVnDateUS(input: string | Date): string {
  return formatVnDateShared(input);
}
export function formatVnNumber(value: number): string {
  if (!Number.isFinite(value)) return FALLBACK;
  return new Intl.NumberFormat(VN_LOCALE).format(value);
}

// packages/sync-protocol/src/vn-date-format-contract.ts
// Zod-first SSOT for Vietnamese date PRESENTATION across the whole platform.
//
// WHY THIS EXISTS (2026). The dispatch board, the order-detail view and the
// Lenh dieu xe Excel export each built their own Intl.DateTimeFormat with an
// English locale (en-US / en-GB), so a Vietnamese-only product rendered
// Jul 19, 2026 to dispatchers who read 19/07/2026. Three independent
// formatters also meant three independent timezone decisions, and one of them
// (the dispatch board PLANNED_FORMATTER) carried NO timeZone at all: an
// evening UTC instant therefore rendered the WRONG CALENDAR DAY, and the RSC
// server render could disagree with the client hydration render. Date format
// is a presentation contract, not a per-component choice, so it lives here in
// the one package every app already depends on (api, ops-web, driver-app,
// owner-app, main-worker, e2e, test-fixtures).
//
// SCOPE. This module owns HUMAN-FACING date text only. It deliberately does
// NOT own machine keys: owner-metrics.service.ts and trip-history-grouping.ts
// use the en-CA locale on purpose because en-CA emits ISO YYYY-MM-DD ordering
// for grouping keys. Those are data, not presentation, and must not be
// migrated to vi-VN.
//
// WHY NUMERIC dd/MM/yyyy AND NOT THE vi-VN dateStyle DEFAULT. Intl vi-VN with
// dateStyle medium emits 19 thg 7, 2026 (an abbreviated-month form). A
// dispatch board is a dense operational table read at a glance and re-keyed
// into Excel; the Vietnamese national convention for that context is the
// all-numeric day-first form, which is also unambiguous, fixed-width and
// sort-stable. So the contract pins explicit 2-digit day / 2-digit month /
// numeric year rather than delegating to a dateStyle.
//
// EXCEL. The export must write a REAL Date cell carrying a numFmt, never a
// pre-formatted string: a string cannot be sorted, filtered or date-mathed by
// the owner, which is the entire point of a data export. Excel numFmt tokens
// are locale-independent and lower-case (dd/mm/yyyy), which is why the Excel
// constants below differ in case from the Intl description above.
import { z } from 'zod';

// The two axes every formatter in the platform must pin. Never inline these
// literals at a call site -- import them, so a future change is one edit.
export const VN_LOCALE = 'vi-VN' as const;
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;

// Rendered when the instant is absent or unparseable. An em-dash, matching the
// DASH already used by the board, the review view and the export service, so
// the three surfaces agree on what missing looks like.
export const VN_DATE_FALLBACK = '\u2014' as const;

// Canonical presentation styles. Object.freeze + as const gives one runtime
// SSOT; z.enum derives the validator; z.infer derives the type. No hand-written
// union may restate these.
export const VN_DATE_STYLES = Object.freeze([
  // 30/07/2026 -- board columns, detail fields, stop planned dates.
  'date',
  // 30/07/2026 14:05 -- 24-hour, used where the clock time carries meaning
  // (arrival/departure proof, export planned start).
  'dateTime',
  // Ngay 30 thang 07 nam 2026 -- formal printed-document form. Reserved for
  // documents, never for dense tables.
  'dateLong',
] as const);
export const vnDateStyleSchema = z.enum(VN_DATE_STYLES);
export type VnDateStyle = z.infer<typeof vnDateStyleSchema>;

// The exact Intl options each style must use. Exported so tests can assert the
// contract itself rather than re-describing it, and so no call site invents a
// near-miss variant (month: short being exactly the defect this replaces).
export const VN_DATE_INTL_OPTIONS: Readonly<Record<VnDateStyle, Intl.DateTimeFormatOptions>> = Object.freeze({
  date: Object.freeze({
    timeZone: VN_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }),
  dateTime: Object.freeze({
    timeZone: VN_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    // h23 is pinned deliberately. hour12: false alone selects the h24
    // cycle in several ICU builds, which renders midnight as 24:00 of the
    // PREVIOUS day instead of 00:00 -- a silent off-by-one-day on exactly
    // the boundary instants this contract exists to get right. h23 is the
    // 00..23 cycle Vietnamese operational documents use.
    hourCycle: 'h23',
  }),
  dateLong: Object.freeze({
    timeZone: VN_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }),
});

// Long-form vocabulary. Vietnamese UI strings are immutable production
// contracts, so the words live here rather than being spelled at a call site.
export const VN_LONG_DAY_WORD = 'Ngày ' as const;
export const VN_LONG_MONTH_WORD = ' tháng ' as const;
export const VN_LONG_YEAR_WORD = ' năm ' as const;

// Excel number-format tokens. Lower-case and locale-independent per the OOXML
// number-format grammar; applied as a COLUMN style so every cell in the column
// inherits it and new rows cannot drift.
export const VN_EXCEL_DATE_NUMFMT = 'dd/mm/yyyy' as const;
export const VN_EXCEL_DATETIME_NUMFMT = 'dd/mm/yyyy hh:mm' as const;

// Locales that must never appear in a human-facing date formatter. Consumed by
// the repo ratchet test, mirroring the existing token-literal-ratchet and
// enum-parity-guard patterns: the guard fails the build if a new call site
// reintroduces one, so this regression cannot silently return.
export const FORBIDDEN_UI_DATE_LOCALES = Object.freeze([
  'en-US',
  'en-GB',
  'en',
] as const);
export type ForbiddenUiDateLocale = (typeof FORBIDDEN_UI_DATE_LOCALES)[number];

// Structural predicates instead of regular expressions: they are readable,
// they are unit-testable on their own, and they keep this file free of the
// escape sequences that make cross-tool file writes fragile.
function isTwoDigit(part: string): boolean {
  if (part.length !== 2) return false;
  for (const ch of part) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

function isFourDigit(part: string): boolean {
  if (part.length !== 4) return false;
  for (const ch of part) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

// True for exactly dd/MM/yyyy. Used by tests and by any boundary that accepts
// a rendered Vietnamese date back from a client.
export function isVnDateString(value: string): boolean {
  const parts = value.split('/');
  if (parts.length !== 3) return false;
  const day = parts[0];
  const month = parts[1];
  const year = parts[2];
  if (day === undefined || month === undefined || year === undefined) return false;
  return isTwoDigit(day) && isTwoDigit(month) && isFourDigit(year);
}

// True for exactly dd/MM/yyyy HH:mm (24-hour, single space separator).
export function isVnDateTimeString(value: string): boolean {
  const halves = value.split(' ');
  if (halves.length !== 2) return false;
  const datePart = halves[0];
  const timePart = halves[1];
  if (datePart === undefined || timePart === undefined) return false;
  if (!isVnDateString(datePart)) return false;
  const clock = timePart.split(':');
  if (clock.length !== 2) return false;
  const hh = clock[0];
  const mm = clock[1];
  if (hh === undefined || mm === undefined) return false;
  return isTwoDigit(hh) && isTwoDigit(mm);
}

export const vnDateStringSchema = z
  .string()
  .refine(isVnDateString, { message: 'Expected a Vietnamese date in dd/MM/yyyy form' });
export type VnDateString = z.infer<typeof vnDateStringSchema>;

export const vnDateTimeStringSchema = z
  .string()
  .refine(isVnDateTimeString, { message: 'Expected a Vietnamese date-time in dd/MM/yyyy HH:mm form' });
export type VnDateTimeString = z.infer<typeof vnDateTimeStringSchema>;

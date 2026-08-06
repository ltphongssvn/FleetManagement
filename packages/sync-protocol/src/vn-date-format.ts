// packages/sync-protocol/src/vn-date-format.ts
// GREEN implementation for the Vietnamese date presentation contract.
// Contract + rationale: ./vn-date-format-contract.ts. RED spec that drove
// this file into existence: ../test/vn-date-format.test.ts.
//
// WHY formatToParts AND NOT format(). Calling format() would hand back a
// locale-assembled string whose SEPARATOR and FIELD ORDER are decided by the
// ICU data bundled with whichever Node build happens to be running. That is
// fine for prose and wrong for an operational contract: a minor ICU bump could
// silently reorder a date-time into 00:30 20/07/2026, or swap the slash for a
// different separator, and every downstream assertion (unit, e2e, and the
// Excel round-trip) would move with it. formatToParts gives the localized and
// timezone-shifted FIELDS, and this module assembles them, so the platform
// owns the shape while ICU owns only the arithmetic.
//
// WHY A NAMED FIELD STRUCT AND NOT Record<string, string>. An index signature
// would force every read through bracket syntax under the repo tsconfig
// (noPropertyAccessFromIndexSignature, TS4111) and, worse, would accept any
// misspelled field name at compile time. The explicit optional-field struct
// below makes each supported field a real property: typos fail to compile, and
// the undefined guards in each formatter are then genuinely exhaustive.
//
// WHY THE FORMATTERS ARE MODULE-LEVEL CONSTANTS. Constructing an
// Intl.DateTimeFormat is the expensive part (locale data resolution); the
// dispatch board formats one date per row per render. Building the formatter
// once at module load is the documented reuse pattern and keeps the board
// render allocation-free on this path.
//
// PURITY. No ambient state is read: no Date.now, no host timezone, no host
// locale. Both the locale and the timezone come from the contract, so an RSC
// server render and the client hydration render of the same instant produce
// byte-identical output and React never reports a mismatch.
import {
  VN_LOCALE,
  VN_DATE_FALLBACK,
  VN_DATE_INTL_OPTIONS,
  VN_LONG_DAY_WORD,
  VN_LONG_MONTH_WORD,
  VN_LONG_YEAR_WORD,
} from './vn-date-format-contract.js';

// Everything a caller might hold: an ISO string from the wire, an epoch
// millisecond number, a Date from the driver, or an explicit absence.
export type VnDateInput = string | number | Date | null | undefined;

const DATE_FORMATTER = new Intl.DateTimeFormat(VN_LOCALE, VN_DATE_INTL_OPTIONS.date);
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(VN_LOCALE, VN_DATE_INTL_OPTIONS.dateTime);

// The localized, timezone-shifted fields this module knows how to assemble.
// Every field is optional because formatToParts only emits what the options
// requested: the date-only formatter yields no hour or minute.
interface VnDateFields {
  day?: string;
  month?: string;
  year?: string;
  hour?: string;
  minute?: string;
}

// Narrow any accepted input to a valid Date, or null. An unparseable string
// yields an Invalid Date whose getTime is NaN; that must become the shared
// fallback, never the literal text Invalid Date leaking into the UI.
function toDate(input: VnDateInput): Date | null {
  if (input === null || input === undefined) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Collect the fields of interest. Literal parts are the locale separators we
// are deliberately discarding in favour of the contract shape.
function partsOf(formatter: Intl.DateTimeFormat, d: Date): Readonly<VnDateFields> {
  const out: VnDateFields = {};
  for (const part of formatter.formatToParts(d)) {
    switch (part.type) {
      case 'day':
        out.day = part.value;
        break;
      case 'month':
        out.month = part.value;
        break;
      case 'year':
        out.year = part.value;
        break;
      case 'hour':
        out.hour = part.value;
        break;
      case 'minute':
        out.minute = part.value;
        break;
      default:
        break;
    }
  }
  return out;
}

// ICU may still emit the 24 hour for midnight on builds where the h23 request
// is not honoured. Normalizing here means a wrong hour can never combine with
// a correct day to produce a plausible-looking but wrong timestamp.
function normalizeHour(hour: string): string {
  return hour === '24' ? '00' : hour;
}

// dd/MM/yyyy. The single formatter for every date-only surface: board columns,
// order-detail fields, per-stop planned dates.
export function formatVnDate(input: VnDateInput): string {
  const d = toDate(input);
  if (d === null) return VN_DATE_FALLBACK;
  const { day, month, year } = partsOf(DATE_FORMATTER, d);
  if (day === undefined || month === undefined || year === undefined) return VN_DATE_FALLBACK;
  return day + '/' + month + '/' + year;
}

// dd/MM/yyyy HH:mm on a 00..23 clock. Used where the wall-clock time carries
// operational meaning, such as an arrival or departure record.
export function formatVnDateTime(input: VnDateInput): string {
  const d = toDate(input);
  if (d === null) return VN_DATE_FALLBACK;
  const { day, month, year, hour, minute } = partsOf(DATE_TIME_FORMATTER, d);
  if (day === undefined || month === undefined || year === undefined) return VN_DATE_FALLBACK;
  if (hour === undefined || minute === undefined) return VN_DATE_FALLBACK;
  return day + '/' + month + '/' + year + ' ' + normalizeHour(hour) + ':' + minute;
}

// The formal printed-document form, assembled from the contract vocabulary so
// the Vietnamese wording stays a single immutable production string.
export function formatVnDateLong(input: VnDateInput): string {
  const d = toDate(input);
  if (d === null) return VN_DATE_FALLBACK;
  const { day, month, year } = partsOf(DATE_FORMATTER, d);
  if (day === undefined || month === undefined || year === undefined) return VN_DATE_FALLBACK;
  return VN_LONG_DAY_WORD + day + VN_LONG_MONTH_WORD + month + VN_LONG_YEAR_WORD + year;
}

// ---------------------------------------------------------------------------
// Field bridge: typed Vietnamese text <-> ISO wire value.
//
// WHY THIS EXISTS. The native input type=date renders its visible text in the
// BROWSER locale, which application code cannot override -- not with lang, not
// with CSS, not from JS. On a Vietnamese-only product that means dispatchers
// see mm/dd/yyyy and an English calendar no matter what the app does, so the
// control has to be replaced by an app-owned field. A replacement must do its
// own parsing, and since the value it submits is consumed by
// ExportDateRangeSchema and the create-order action, that conversion belongs
// in the contract rather than inside one widget.
//
// WHY ROUND-TRIP VERIFICATION RATHER THAN RANGE CHECKS. Date.UTC(2026, 1, 31)
// does not fail on 31 February; it silently rolls forward to 3 March. Range
// checks alone would therefore accept a date the dispatcher never meant, and
// the error would surface as a mis-scheduled truck rather than a form message.
// Building the date and then confirming its parts still match what was typed
// catches every impossible day, including leap-year cases, with no month-length
// table to keep correct.

// Zero-pad to two characters without touching the shell-fragile parts of the
// language (no template literals anywhere in this file).
function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n);
}

function allDigits(part: string): boolean {
  if (part.length === 0) return false;
  for (const ch of part) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

// Typed dd/MM/yyyy (day and month may be 1 or 2 digits) -> 'yyyy-mm-dd', or
// null when the text is not a real calendar date. null is deliberately not an
// exception: this runs on every keystroke of a controlled field, where an
// in-progress entry is normal rather than exceptional.
export function parseVnDateToIso(input: string): string | null {
  const parts = input.trim().split('/');
  if (parts.length !== 3) return null;
  const dayText = parts[0];
  const monthText = parts[1];
  const yearText = parts[2];
  if (dayText === undefined || monthText === undefined || yearText === undefined) return null;
  if (!allDigits(dayText) || !allDigits(monthText) || !allDigits(yearText)) return null;
  // A two-digit year is ambiguous in an operational document that is printed,
  // filed and audited, so it is rejected rather than guessed at.
  if (yearText.length !== 4) return null;
  if (dayText.length > 2 || monthText.length > 2) return null;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const d = new Date(Date.UTC(year, month - 1, day));
  // The rollover check described above: if any part changed, the typed day does
  // not exist in that month.
  if (d.getUTCFullYear() !== year) return null;
  if (d.getUTCMonth() !== month - 1) return null;
  if (d.getUTCDate() !== day) return null;
  return String(year) + '-' + pad2(month) + '-' + pad2(day);
}

// 'yyyy-mm-dd' -> typed dd/MM/yyyy for display in the field. Returns an empty
// string for empty or malformed input so an unset field renders blank instead
// of an em-dash or a guess; the em-dash fallback belongs to read-only display,
// not to an editable control.
export function isoToVnDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return '';
  const yearText = parts[0];
  const monthText = parts[1];
  const dayText = parts[2];
  if (yearText === undefined || monthText === undefined || dayText === undefined) return '';
  if (yearText.length !== 4 || monthText.length !== 2 || dayText.length !== 2) return '';
  if (!allDigits(yearText) || !allDigits(monthText) || !allDigits(dayText)) return '';
  const round = parseVnDateToIso(dayText + '/' + monthText + '/' + yearText);
  if (round === null) return '';
  return dayText + '/' + monthText + '/' + yearText;
}

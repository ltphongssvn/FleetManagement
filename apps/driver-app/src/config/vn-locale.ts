// apps/driver-app/src/config/vn-locale.ts
// Centralized VN locale/timezone formatting. Backend runs on Railway
// (US/SG region); drivers + dispatchers operate in Vietnam. Server emits
// UTC ISO timestamps; the UI must always render in Asia/Ho_Chi_Minh
// (UTC+7) with vi-VN conventions, independent of device tz/locale.
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

export function formatVnNumber(value: number): string {
  if (!Number.isFinite(value)) return FALLBACK;
  return new Intl.NumberFormat(VN_LOCALE).format(value);
}

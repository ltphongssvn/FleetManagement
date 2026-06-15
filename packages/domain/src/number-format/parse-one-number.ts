// packages/domain/src/number-format/parse-one-number.ts
export function parseOneNumber(raw: string): number | null {
  // Strip a TRAILING unit token only (kg/kgs/Kg.) — never interior letters, so an
  // OCR letter-for-digit misread (e.g. "2O730") is rejected, never silently "fixed".
  let s = raw.replace(/\s*kgs?\.?\s*$/i, '').trim();
  // Normalize every Unicode space that locales/VLMs emit as a group separator
  // (ASCII, NBSP U+00A0, narrow no-break U+202F, thin U+2009) to one ASCII space.
  s = s.replace(/[\s\u00A0\u202F\u2009]+/g, ' ').trim();
  // Space-as-thousands: accept ONLY well-formed groups (1-3 then ddd groups),
  // then drop the spaces so a malformed run like "2 0 7 3 0" still rejects.
  if (s.includes(' ')) {
    if (!/^-?[0-9]{1,3}(?: [0-9]{3})+(?:[.,][0-9]{1,2})?$/.test(s)) return null;
    s = s.replace(/ /g, '');
  }
  // The regex is the single gate: grouped form (1-3 digits then .ddd groups)
  // or a plain digit run, with an optional 1-2 digit decimal tail.
  if (!/^-?(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep === -1) return Number(s);
  const tail = s.slice(lastSep + 1);
  const head = s.slice(0, lastSep).replace(/[.,]/g, '');
  return Number(tail.length < 3 ? head + '.' + tail : head + tail);
}

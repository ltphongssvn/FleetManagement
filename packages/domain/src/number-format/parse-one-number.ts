// packages/domain/src/number-format/parse-one-number.ts
export function parseOneNumber(raw: string): number | null {
  const cleaned = raw.replace(/kg/gi, '').trim();
  // The regex is the single gate: grouped form (1-3 digits then .ddd groups)
  // or a plain digit run, with an optional 1-2 digit decimal tail.
  if (!/^-?(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?$/.test(cleaned)) return null;
  // Locate the rightmost separator via index math (slice returns a string, so no
  // optional pop()/nullish fallback -> no provably-dead branch to instrument).
  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  if (lastSep === -1) return Number(cleaned);
  const tail = cleaned.slice(lastSep + 1);
  const head = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
  // A 1-2 digit trailing run is a decimal; a 3-digit run is the last thousands group.
  return Number(tail.length < 3 ? head + '.' + tail : head + tail);
}

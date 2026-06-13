// packages/domain/src/number-format/parse-one-number.ts
export function parseOneNumber(raw: string): number | null {
  const cleaned = raw.replace(/kg/gi, '').trim();
  // The regex is the single gate: grouped form (1-3 digits then .ddd groups)
  // or a plain digit run, with an optional 1-2 digit decimal tail. Everything
  // after a match is total by construction -- no defensive branches needed.
  if (!/^-?(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?$/.test(cleaned)) return null;
  const groups = cleaned.split(/[.,]/);
  // split() always yields >=1 element, so pop() cannot be undefined here;
  // structured this way to satisfy both no-non-null-assertion and
  // non-nullable-type-assertion-style without a dead fallback branch.
  const last = groups.pop() ?? '';
  const hasFrac = groups.length > 0 && last.length < 3;
  return Number(hasFrac ? groups.join('') + '.' + last : groups.join('') + last);
}

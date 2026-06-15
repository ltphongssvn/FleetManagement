// subject under test: workers/main-worker/src/extraction/extraction-policy.ts
export const NET_WEIGHT_SANITY = { minKg: 100, maxKg: 60000 } as const;

export function parseOneNumber(raw: string): number | null {
  const cleaned = raw.replace(/kg/gi, '').trim();
  if (!/^-?(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?$/.test(cleaned)) return null;
  const groups = cleaned.split(/[.,]/);
  const last = groups.pop() ?? '';
  const hasFrac = groups.length > 0 && last.length < 3;
  return Number(hasFrac ? groups.join('') + '.' + last : groups.join('') + last);
}

export function parseNetWeightKg(rawValue: string): number | null {
  return parseOneNumber(rawValue);
}

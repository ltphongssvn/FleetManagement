// scripts/env-bootstrap-dotenv.ts
// PURE CORE: what a .env may contain before it is safe to encrypt.
//
// ROOT CAUSE THIS CLOSES, observed 2026-08-14 on this machine's first encrypt.
// A .env carrying FLEET_SKIP_ANDROID twice encrypted CLEANLY and could never be
// decrypted again:
//
//   yaml: unmarshal errors:
//     line 16: mapping key "FLEET_SKIP_ANDROID" already defined at line 15
//
// dotenv PERMITS duplicate keys -- last assignment wins, which is why nobody
// noticed -- while YAML FORBIDS them. sops converts dotenv to YAML on the way
// in, so the duplicate is legal at the source, illegal at the destination, and
// the conversion never complains. The artifact is a corpse: encryption reports
// success and decryption is impossible for every recipient, forever.
//
// This is upstream sops issue getsops/sops/issues/851, open since 2021 and
// still present in 3.13.3. There is no fix to wait for, and the documented
// recovery is to hand-edit the offending key out of the ciphertext. So the
// check belongs HERE, before a single byte is encrypted: a tool whose whole
// purpose is fail-closed must not emit an unreadable artifact and call it done.
//
// Only DUPLICATES are rejected. This is deliberately not a dotenv validator:
// quoting, escapes, interpolation and export prefixes are sops's business, and
// duplicating its parser here would create exactly the second source of truth
// this repo keeps removing. One rule, the one that silently destroys the file.

const NL = String.fromCharCode(10);
const HASH = String.fromCharCode(35);

/** A key assigned more than once, with every 1-based line it appears on. Lines
 *  are reported because the operator has to find them, and "somewhere in .env"
 *  is the diagnosability failure this repo keeps fixing elsewhere. */
export interface DotenvDuplicate {
  readonly key: string;
  readonly lines: readonly number[];
}

/** The key part of a dotenv assignment, or null for a line that assigns
 *  nothing. Comments, blanks and continuation text carry no key.
 *
 *  A leading `export ` is stripped: `export FOO=1` and `FOO=1` assign the same
 *  variable, so treating them as different keys would miss a real duplicate. */
function assignedKey(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(HASH)) return null;
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed;
  const eq = withoutExport.indexOf('=');
  if (eq <= 0) return null;
  const key = withoutExport.slice(0, eq).trim();
  return key.length === 0 ? null : key;
}

/** Every key assigned more than once, in first-appearance order.
 *
 *  Order matters for a stable message: a set iteration would reorder the report
 *  between runs and make two identical failures look different. */
export function findDuplicateKeys(content: string): readonly DotenvDuplicate[] {
  const seen = new Map<string, number[]>();
  const order: string[] = [];
  content.split(NL).forEach((line, index) => {
    const key = assignedKey(line);
    if (key === null) return;
    const lines = seen.get(key);
    if (lines === undefined) {
      seen.set(key, [index + 1]);
      order.push(key);
      return;
    }
    lines.push(index + 1);
  });
  const duplicates = order
    .map((key) => ({ key, lines: Object.freeze(seen.get(key) ?? []) }))
    .filter((entry) => entry.lines.length > 1)
    .map((entry) => Object.freeze(entry));
  return Object.freeze(duplicates);
}

/** An operator-facing sentence naming every duplicate and where it sits.
 *
 *  Names the CONSEQUENCE, not just the rule: "duplicate key" reads as pedantry
 *  until you know it produces ciphertext nobody can ever open. */
export function describeDuplicates(duplicates: readonly DotenvDuplicate[]): string {
  const listed = duplicates
    .map((d) => '  ' + d.key + ' on lines ' + d.lines.join(', '))
    .join(NL);
  return [
    'refusing to encrypt: .env assigns a key more than once',
    listed,
    'dotenv allows this and YAML does not, so sops would produce ciphertext',
    'that NO recipient can ever decrypt (getsops/sops/issues/851). Remove the',
    'redundant assignment -- dotenv keeps the LAST one -- and encrypt again.',
  ].join(NL);
}

// packages/domain/src/identity/person-name.ts
// Canonical person-name normalization for dispatcher data entry.
//
// The problem (2026 entity-resolution reframe): there is ONE real person, but
// multiple dispatchers key the name in different STYLES -- extra spaces, stray
// invisible characters, composed-vs-decomposed accents, mixed case. Raw-string
// uniqueness lets those variants create duplicate driver identities for the same
// human. The fix is normalize-at-ingestion + a folded match key, the standard
// dual-representation pattern:
//
//   displayName (STORED, shown to users): sanitize + NFC + trim + collapse
//     internal whitespace. Preserves the dispatcher's letter case AND accents --
//     LÊ VĂN CHÂU stays LÊ VĂN CHÂU; only invisible/spacing/unicode-form noise
//     is removed.
//   matchKey (uniqueness + reactivate lookup): lower(displayName). Case-folds
//     WITHOUT stripping accents, so LÊ VĂN CHÂU == Lê Văn Châu (same person) yet
//     LÊ != LE (different people). Diacritics are meaning in Vietnamese, so we
//     deliberately do NOT fold them (no NFKC, no unaccent, no citext).
//
// Both are pure and deterministic; the DB partial lower(full_name) unique index
// mirrors matchKey as the race-safe backstop (app normalization + DB constraint,
// belt-and-suspenders per 2026 practice).
import { z } from 'zod';

// Invisible code points are removed by UNICODE PROPERTY, not by a hand-written
// list. The previous list named only 4 code points (ZWSP/ZWNJ/ZWJ/BOM) while
// this file's own comment already claimed bidi controls were covered -- so the
// list had silently fallen behind its contract, and production ended up with
// TWO ACTIVE rows for one driver. driver_company_active_name_ci_uq is a
// byte-wise index on lower(full_name), so any surviving invisible buys a second
// identity for the same human.
//
// Default_Ignorable_Code_Point (UAX #31) is precisely this class: variation
// selectors, joining controls AND bidirectional ordering controls -- including
// soft hyphen U+00AD, word joiner U+2060, the LRM/RLM marks, and the
// Trojan-Source override/isolate ranges U+202A-202E / U+2066-2069. Driving the
// strip from the property means it cannot drift out of date again.
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

// Collapse every run of Unicode whitespace to a single ASCII space and trim.
function collapseWhitespace(raw: string): string {
  // Any run of whitespace (incl. NBSP \u00A0, tabs, newlines) -> one space.
  return raw.replace(/\s+/g, ' ').trim();
}

/** The STORED, user-visible name: sanitized, NFC-composed, whitespace-normalized,
 *  with the dispatcher's case and accents preserved. Normalize at ingestion so a
 *  name is byte-stable regardless of keying style.
 *
 *  ORDER IS LOAD-BEARING: sanitize BEFORE NFC. An invisible sitting between a
 *  base letter and its combining mark blocks canonical composition, so running
 *  NFC first leaves 'Le' + ZWSP + U+0302 uncomposed; stripping afterwards then
 *  yields a DECOMPOSED 'ê' that is byte-different from the precomposed spelling
 *  -- two visually identical names, two different index keys. Sanitizing first
 *  removes the blocker so NFC can compose. */
export function normalizeDisplayName(raw: string): string {
  return collapseWhitespace(raw.replace(IGNORABLE, '').normalize('NFC'));
}

/** The MATCH KEY for uniqueness + reactivate lookup: the display name folded to
 *  lower case. Case-insensitive but accent-SENSITIVE (lower() never strips
 *  diacritics), so it mirrors the DB partial lower(full_name) unique index. */
export function personNameMatchKey(raw: string): string {
  return normalizeDisplayName(raw).toLowerCase();
}

/** SSOT for a driver/person display-name field at any trust boundary (the
 *  create + update controllers both derive from this, so the two dispatcher
 *  entry points normalize identically and cannot drift). Validates length on the
 *  RAW input, then transforms to the canonical display form. min(1) is checked
 *  BEFORE the transform so a whitespace-only name is rejected, and AGAIN after
 *  (a name that is only invisible characters normalizes to '') to reject
 *  normalize-to-empty. */
export const DriverNameSchema = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeDisplayName)
  .refine((s) => s.length > 0, { message: 'name is empty after normalization' });
export type DriverName = z.infer<typeof DriverNameSchema>;

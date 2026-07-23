// packages/domain/src/identity/person-name.ts
// Canonical person-name normalization for dispatcher data entry.
//
// The problem (2026 entity-resolution reframe): there is ONE real person, but
// multiple dispatchers key the name in different STYLES -- extra spaces, stray
// zero-width characters, composed-vs-decomposed accents, mixed case. Raw-string
// uniqueness lets those variants create duplicate driver identities for the same
// human. The fix is normalize-at-ingestion + a folded match key, the standard
// dual-representation pattern:
//
//   displayName (STORED, shown to users): NFC + trim + collapse internal
//     whitespace. Preserves the dispatcher's letter case AND accents -- LÊ VĂN
//     CHÂU stays LÊ VĂN CHÂU; only inconsistent spacing / unicode form is fixed.
//   matchKey (uniqueness + reactivate lookup): lower(displayName). Case-folds
//     WITHOUT stripping accents, so LÊ VĂN CHÂU == Lê Văn Châu (same person) yet
//     LÊ != LE (different people). Diacritics are meaning in Vietnamese, so we
//     deliberately do NOT fold them (no NFKC, no unaccent, no citext).
//
// Both are pure and deterministic; the DB partial lower(full_name) unique index
// mirrors matchKey as the race-safe backstop (app normalization + DB constraint,
// belt-and-suspenders per 2026 practice).
import { z } from 'zod';

// Collapse every run of Unicode whitespace to a single ASCII space, drop
// zero-width / BOM / bidi controls that make visually-identical names differ in
// bytes, and trim the ends.
function normalizeWhitespace(raw: string): string {
  return raw
    // Zero-width space, ZWNJ, ZWJ, BOM/ZWNBSP -- invisible, must not distinguish names.
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    // Any run of whitespace (incl. NBSP \u00A0, tabs, newlines) -> one space.
    .replace(/\s+/g, ' ')
    .trim();
}

/** The STORED, user-visible name: NFC-composed, whitespace-normalized, with the
 *  dispatcher's case and accents preserved. Normalize at ingestion so a name is
 *  byte-stable regardless of keying style. */
export function normalizeDisplayName(raw: string): string {
  return normalizeWhitespace(raw.normalize('NFC'));
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
 *  (a name that is only zero-width chars normalizes to '') to reject
 *  normalize-to-empty. */
export const DriverNameSchema = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeDisplayName)
  .refine((s) => s.length > 0, { message: 'name is empty after normalization' });
export type DriverName = z.infer<typeof DriverNameSchema>;

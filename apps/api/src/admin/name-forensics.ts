// apps/api/src/admin/name-forensics.ts
// Per-row name forensics: attribute a byte difference between two
// visually identical names to a SPECIFIC cause.
//
// WHY THIS IS SEPARATE FROM THE ROSTER AUDIT: auditDriverRoster folds names
// with NFC normalization AND whitespace collapsing at once, which is right
// for DETECTING a collision and useless for EXPLAINING one. The explanation
// selects the fix. An NFD-composed row means lower(full_name) can never see
// the twin and the DB index expression itself must normalize. A
// whitespace-differing row means a writer reached the table without passing
// through normalizeDisplayName, and the app boundary is the leak. Those are
// different repairs, so the evidence has to separate them.
//
// Every dimension is reported INDEPENDENTLY: a single name can be
// decomposed, double-spaced and carrying an invisible simultaneously, and
// collapsing that into one verdict would hide two of the three causes.
//
// Pure and deterministic; no DB access, no I/O. isCanonical is the
// conjunction, defined as "already in the form normalizeDisplayName would
// produce", so a canonical row is one the write path cannot improve.
//
// CODE POINTS, NOT GRAPHEMES, AND NOT SPREAD. Counting iterates with for...of,
// which walks code points. Intl.Segmenter -- what no-misused-spread suggests --
// would be actively WRONG here: grapheme segmentation GROUPS a base letter with
// its combining marks, which is exactly the difference this file exists to
// expose, so a decomposed name would count identically to its composed twin and
// the diagnosis would silently vanish. Spread and .split('') are avoided
// because the lint rule forbids them, per the house precedent that resolved
// this same rule with an explicit loop rather than a disable comment.
import { z } from 'zod';

export const NameForensicsSchema = z.object({
  isNfc: z.boolean(),
  hasCollapsibleWhitespace: z.boolean(),
  hasIgnorableCodePoint: z.boolean(),
  hasDiacritics: z.boolean(),
  codePointCount: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
  isCanonical: z.boolean(),
});
export type NameForensics = z.infer<typeof NameForensicsSchema>;

// Same Unicode PROPERTY the domain normalizer strips, not a hand-written
// list: variation selectors, joiners, bidi controls, soft hyphen, word
// joiner. A list would drift out of date, which is the documented cause of
// the previous two-active-rows incident.
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

// A name is whitespace-canonical when it equals itself with every run of
// Unicode whitespace collapsed to one ASCII space and the ends trimmed.
// NBSP is whitespace to \s, so it is caught here rather than needing its
// own rule -- it reads as a space to a dispatcher but is a different byte.
function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// Diacritic presence is DIAGNOSTIC ONLY and never a matching rule: accents
// carry meaning in Vietnamese, so LE and LE-with-diacritics are different
// people and are never folded together. Detected on the decomposed form,
// where every accent becomes an explicit combining mark (U+0300-U+036F).
function hasDiacritics(raw: string): boolean {
  return /[\u0300-\u036f]/u.test(raw.normalize('NFD'));
}

function countCodePoints(raw: string): number {
  let n = 0;
  for (const _ch of raw) n += 1;
  return n;
}

export function nameForensics(raw: string): NameForensics {
  const isNfc = raw.normalize('NFC') === raw;
  const hasCollapsibleWhitespace = collapseWhitespace(raw) !== raw;
  const hasIgnorableCodePoint = IGNORABLE.test(raw);
  return {
    isNfc,
    hasCollapsibleWhitespace,
    hasIgnorableCodePoint,
    hasDiacritics: hasDiacritics(raw),
    codePointCount: countCodePoints(raw),
    byteLength: Buffer.byteLength(raw, 'utf8'),
    isCanonical: isNfc && !hasCollapsibleWhitespace && !hasIgnorableCodePoint,
  };
}

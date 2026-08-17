// packages/domain/src/identity/distinct-person-name.ts
// Suggests the next free DISTINGUISHING SUFFIX for a genuinely-second person
// who shares a driver name with someone already registered.
//
// Why this exists: Vietnamese driver names repeat rarely, but they do repeat.
// driver_company_active_name_ci_uq correctly refuses the duplicate, and the API
// answered with a bare "Tài xế X đã tồn tại". That is a DEAD END for the
// dispatcher: the second person is real and still has to be registered, so
// with no sanctioned path forward the dispatcher invents one -- a trailing
// space, a stray dot, a case tweak, an invisible character pasted from a chat
// app. Every one of those creates a SECOND IDENTITY for the FIRST human, which
// is the exact failure that put two active NGUYỄN AN BÌNH ĐỨC rows in prod.
//
// So the rule is stated positively and the system names the answer: the first
// person keeps the bare name, the second is registered with suffix B, the third
// C, and so on. The API puts the concrete suggestion in the 409 so the
// dispatcher types what it says instead of improvising.
import { personNameMatchKey, normalizeDisplayName } from './person-name.js';

// B first: the person already registered holds the bare name, so a suffix is
// only ever needed from the SECOND person onward. ASCII-only and single-letter
// so the suffix itself can never smuggle in a unicode variant of the very
// problem this module exists to prevent.
export const DISTINCT_NAME_SUFFIXES = Object.freeze([
  'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const);
export type DistinctNameSuffix = (typeof DISTINCT_NAME_SUFFIXES)[number];

/** The first name in the B, C, D... series that is not already taken.
 *
 *  Returns the BASE name when nothing is taken (the caller may be checking
 *  pre-emptively), and null when every suffix is exhausted -- at which point a
 *  human must intervene rather than the system inventing a scheme nobody agreed
 *  to. Taken names are matched with personNameMatchKey, the SAME fold as the DB
 *  partial unique index, so a case variant or an invisible-bearing row counts as
 *  taken; a second comparison rule here would be free to drift from the index
 *  and hand back a suggestion the INSERT then rejects.
 *
 *  A freed letter is never reused: if B was retired and C is live, the next
 *  suggestion is D. Recycling B would hand a new person an identity dispatchers
 *  may still associate with the previous one. */
export function suggestDistinctDriverName(
  baseName: string,
  takenNames: readonly string[],
): string | null {
  const base = normalizeDisplayName(baseName);
  const taken = new Set(takenNames.map(personNameMatchKey));
  if (!taken.has(personNameMatchKey(base))) return base;
  let lastTakenIndex = -1;
  for (let i = 0; i < DISTINCT_NAME_SUFFIXES.length; i++) {
    const suffix = DISTINCT_NAME_SUFFIXES[i];
    /* v8 ignore next -- index is bounded by the loop condition */
    if (suffix === undefined) continue;
    if (taken.has(personNameMatchKey(base + ' ' + suffix))) lastTakenIndex = i;
  }
  const next = DISTINCT_NAME_SUFFIXES[lastTakenIndex + 1];
  return next === undefined ? null : base + ' ' + next;
}

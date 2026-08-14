// scripts/estate-reasons-across.ts
// The flat reason set for a whole estate, computed ONCE.
//
// WHY ITS OWN MODULE. estateTelemetry computed this inline to fill the event's
// `reasons` attribute, and decideEstate needs the same set to choose the
// agent_action and the exit code. Computing it twice is how the emitted action
// and the exit code drift apart -- the precise failure ACTION_EXIT exists to
// prevent, reintroduced one layer up. It cannot live in estate-verify.ts
// beside its callers without estate-action.ts importing that module for it,
// which would close an import cycle: estate-verify already imports
// estate-action for the vocabulary.
//
// Declaration order, not discovery order. A consumer diffing two runs must not
// see a change because the estate happened to be walked differently -- the same
// rule classifyEstate applies to `problems` and estateDigest applies to states.
import { ESTATE_REASONS, type EstateProblem, type EstateReason } from './estate-verify.js';

/** Every reason present anywhere in the estate, de-duplicated, in declaration
 *  order. Takes PROBLEMS rather than a verdict so the function stays usable on
 *  either arm of the discriminated union without narrowing at every call site. */
export function reasonsAcross(
  problems: readonly EstateProblem[],
): readonly EstateReason[] {
  const seen = new Set<EstateReason>();
  for (const p of problems) {
    for (const r of p.reasons) seen.add(r);
  }
  return ESTATE_REASONS.filter((r) => seen.has(r));
}

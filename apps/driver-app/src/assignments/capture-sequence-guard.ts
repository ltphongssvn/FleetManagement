// apps/driver-app/src/assignments/capture-sequence-guard.ts
// Pure policy (driver-bare-minimum arc): enforce IN-ORDER proof capture. The
// 2026 POD standard makes stop sequence a hard rule (proof rules hard to
// bypass), so capturing a stop out of order is BLOCKED with intuitive
// Vietnamese guidance naming the exact stop the driver must photograph first.
// Re-photographing an already-done stop is allowed (legitimate correction),
// and an unknown tapped sequence is allowed (never a false block). The expected
// next stop is the lowest-sequence stop WITHOUT a committed proof photo.
export interface CaptureSequenceStop {
  readonly sequence: number;
  readonly hasManifest: boolean;
  readonly label: string;
}
export interface CaptureSequenceDecision {
  readonly allowed: boolean;
  readonly message: string | null;
}

const ALLOW: CaptureSequenceDecision = { allowed: true, message: null };

export function evaluateCaptureSequence(
  tappedSequence: number,
  stops: readonly CaptureSequenceStop[],
): CaptureSequenceDecision {
  const tapped = stops.find((s) => s.sequence === tappedSequence);
  // Unknown stop, or a stop that already has its photo: never block.
  if (tapped === undefined || tapped.hasManifest) return ALLOW;
  // Expected next stop = lowest-sequence stop still missing a proof photo.
  const pending = stops
    .filter((s) => !s.hasManifest)
    .sort((a, b) => a.sequence - b.sequence);
  const expected = pending[0];
  if (expected === undefined || expected.sequence >= tappedSequence) return ALLOW;
  // The driver is skipping ahead: guide them to the correct stop first.
  return {
    allowed: false,
    message:
      'Vui long chup anh ' + expected.label + ' truoc. ' +
      'Hay chup anh cac kho theo dung thu tu.',
  };
}

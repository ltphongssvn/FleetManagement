// apps/driver-app/src/assignments/road-run-state-label.ts
// Immutable Vietnamese labels for road_run states shown on the assignment
// badge. Drivers in transit must never see raw English state tokens like
// STARTED. Case-insensitive; unknown states fall back to the raw value so a
// future backend state never crashes the screen (it just renders untranslated).
export const ROAD_RUN_STATE_LABEL_VI: Readonly<Record<string, string>> = Object.freeze({
  planned: 'Ch\u1edd \u0111i\u1ec1u xe',
  dispatched: '\u0110\u00e3 \u0111i\u1ec1u xe',
  started: '\u0110ang giao h\u00e0ng',
  completed: '\u0110\u00e3 ho\u00e0n th\u00e0nh',
  cancelled: '\u0110\u00e3 h\u1ee7y',
});
export function roadRunStateLabelVi(state: string): string {
  return ROAD_RUN_STATE_LABEL_VI[state.toLowerCase()] ?? state;
}

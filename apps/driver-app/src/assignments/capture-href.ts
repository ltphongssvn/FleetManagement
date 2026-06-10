// apps/driver-app/src/assignments/capture-href.ts
// Pure builder: transport order id + a stop's capture descriptor -> the Expo
// Router href for that warehouse's manifest-photo proof screen. No native deps,
// so it is unit-tested directly. The capture screen requires stopKind (and, for
// loading, a 0-based stopIndex); without them it renders invalid_stop, so this
// helper is what makes per-warehouse capture reachable from the assignment card.
export interface CaptureStopDescriptor {
  readonly stopKind: 'loading' | 'unloading';
  readonly stopIndex: number | null;
  /** 1-based DB stop.sequence — rides the href so capture can send the
   *  ManifestStopRef ({stopId: null, stopSequence}) at negotiate. */
  readonly sequence: number;
}
export function captureHrefForStop(
  transportOrderId: string,
  stop: CaptureStopDescriptor,
): string {
  const base = '/capture?transportOrderId=' + transportOrderId + '&stopKind=' + stop.stopKind;
  const seq = '&stopSequence=' + String(stop.sequence);
  if (stop.stopKind === 'loading' && stop.stopIndex !== null) {
    return base + '&stopIndex=' + String(stop.stopIndex) + seq;
  }
  return base + seq;
}

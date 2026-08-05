// apps/driver-app/src/assignments/assignment-stops-presenter.ts
// Pure presenter: AssignmentRow.stops[] -> ordered view-model rows for the
// driver assignments card. No native deps (mirrors capture-screen-presenter),
// so it is covered by ordinary unit tests. Vietnamese UI is immutable.
//
// 1-1 parity with the Lệnh điều xe - Tải thùng form: every stop the dispatcher
// created (1..N pickup warehouses + delivery) renders in sequence. Pickups are
// numbered 1-based independently of delivery interleaving ('Kho nhận hàng N');
// deliveries render as 'Kho giao hàng'. A stop is DONE once its proof photo
// (a committed manifest) exists -- the 2026 POD standard derives stop
// completion from captured proof, not a departure timestamp (drivers here
// never mark departures). done drives both the checkmark and remaining.
//
// Each row also carries the capture-route descriptor so the card can deep-link
// to the per-warehouse proof screen (/capture?stopKind=...&stopIndex=...):
//   pickup   -> stopKind 'loading',  stopIndex 0-based (pickup order, = displayIndex-1)
//   delivery -> stopKind 'unloading', stopIndex null (single unloading warehouse)
import type { StopRow } from './assignments-client.js';
export interface AssignmentStopVM {
  readonly key: string;
  readonly sequence: number;
  readonly label: string;
  readonly warehouseName: string;
  readonly done: boolean;
  readonly stopKind: 'loading' | 'unloading';
  readonly stopIndex: number | null;
}
const NO_WAREHOUSE = '— Chưa có kho —';
function isPickup(stopType: string): boolean {
  return stopType.toLowerCase() === 'pickup';
}
export function presentAssignmentStops(stops: readonly StopRow[]): readonly AssignmentStopVM[] {
  let pickupIndex = 0;
  return stops.map((s) => {
    let label: string;
    let stopKind: 'loading' | 'unloading';
    let stopIndex: number | null;
    if (isPickup(s.stopType)) {
      // 0-based loading index for the capture route; 1-based for display.
      stopIndex = pickupIndex;
      pickupIndex += 1;
      label = 'Kho nhận hàng ' + String(pickupIndex);
      stopKind = 'loading';
    } else {
      label = 'Kho giao hàng';
      stopKind = 'unloading';
      stopIndex = null;
    }
    return {
      key: 'stop-' + String(s.sequence),
      sequence: s.sequence,
      label,
      warehouseName: s.warehouseName ?? NO_WAREHOUSE,
      done: s.hasManifest === true,
      stopKind,
      stopIndex,
    };
  });
}

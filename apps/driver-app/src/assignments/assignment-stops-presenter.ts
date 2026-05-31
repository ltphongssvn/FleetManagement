// apps/driver-app/src/assignments/assignment-stops-presenter.ts
// Pure presenter: AssignmentRow.stops[] -> ordered view-model rows for the
// driver assignments card. No native deps (mirrors capture-screen-presenter),
// so it is covered by ordinary unit tests. Vietnamese UI is immutable.
//
// 1-1 parity with the Lệnh điều xe - Tải thùng form: every stop the dispatcher
// created (1..N pickup warehouses + delivery) renders in sequence. Pickups are
// numbered 1-based independently of delivery interleaving ('Kho nhận hàng N');
// deliveries render as 'Kho giao hàng'. A stop is done once departedAt is set.
import type { StopRow } from './assignments-client.js';
export interface AssignmentStopVM {
  readonly key: string;
  readonly sequence: number;
  readonly label: string;
  readonly warehouseName: string;
  readonly done: boolean;
}
const NO_WAREHOUSE = '— Chưa có kho —';
function isPickup(stopType: string): boolean {
  return stopType.toLowerCase() === 'pickup';
}
export function presentAssignmentStops(stops: readonly StopRow[]): readonly AssignmentStopVM[] {
  let pickupIndex = 0;
  return stops.map((s) => {
    let label: string;
    if (isPickup(s.stopType)) {
      pickupIndex += 1;
      label = 'Kho nhận hàng ' + String(pickupIndex);
    } else {
      label = 'Kho giao hàng';
    }
    return {
      key: 'stop-' + String(s.sequence),
      sequence: s.sequence,
      label,
      warehouseName: s.warehouseName ?? NO_WAREHOUSE,
      done: s.departedAt !== null,
    };
  });
}

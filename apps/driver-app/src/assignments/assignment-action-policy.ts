// apps/driver-app/src/assignments/assignment-action-policy.ts
// Pure decision: given a road_run state, what single action may the driver
// take next? The driver UI shows exactly one button (or none), keeping the
// workflow simple. Lifecycle: planned -> dispatched -> started -> completed,
// matching the API's driver-delivery FSM (accept / start / complete).
export type DriverActionKind = 'accept' | 'start' | 'complete' | 'none';
export interface DriverAction {
  readonly kind: DriverActionKind;
  readonly label?: string;
}
export function nextDriverAction(state: string): DriverAction {
  switch (state.toLowerCase()) {
    case 'planned':
      return { kind: 'accept', label: 'Nhận lệnh' };
    case 'dispatched':
      return { kind: 'start', label: 'Bắt đầu chuyến' };
    case 'started':
      return { kind: 'complete', label: 'Hoàn thành' };
    default:
      // completed (terminal) or any unrecognised state -> no action.
      return { kind: 'none' };
  }
}

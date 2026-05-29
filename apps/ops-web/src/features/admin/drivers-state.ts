// apps/ops-web/src/features/admin/drivers-state.ts
export interface DeviceInfo {
  readonly deviceId: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly lastSeenAt: string | null;
  readonly udid: string | null;
}

export interface VehicleInfo {
  readonly vehicleId: string;
  readonly plate: string;
}

export interface DriverRow {
  readonly driverId: string;
  readonly fullName: string;
  readonly operatorId: string | null;
  readonly assignedVehicle: VehicleInfo | null;
  readonly assignmentId: string | null;
  readonly devices: readonly DeviceInfo[];
}

export type AdminDriversState =
  | { kind: 'loading' }
  | { kind: 'loaded'; rows: readonly DriverRow[] }
  | { kind: 'error'; message: string };

export type AdminDriversAction =
  | { type: 'loaded'; rows: readonly DriverRow[] }
  | { type: 'error'; message: string }
  | { type: 'reset' };

export function reduceAdminDriversState(
  _state: AdminDriversState,
  action: AdminDriversAction,
): AdminDriversState {
  switch (action.type) {
    case 'loaded':
      return { kind: 'loaded', rows: action.rows };
    case 'error':
      return { kind: 'error', message: action.message };
    case 'reset':
      return { kind: 'loading' };
  }
}

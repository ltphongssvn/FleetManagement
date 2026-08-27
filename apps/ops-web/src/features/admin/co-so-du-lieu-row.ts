// apps/ops-web/src/features/admin/co-so-du-lieu-row.ts
// Pure row -> status-cell mapper + status partition for the Cơ sở dữ liệu
// table. Composes the shipped pieces only: classifyDriverDbStatus (AdminDriverRow
// facts -> DriverDbStatus) from @fleet/sync-protocol + presentDriverDbStatus
// (code -> {label, tone}) from the ops-web presenter. It consumes AdminDriverRow
// (the SSOT row) and NEVER defines a parallel row shape -- honouring the driver-
// attention arc lesson (derive from the SSOT via classifier+presenter; the old
// hand-written drivers-state row was deleted for exactly this reason). The
// partition is by status so the table renders each driver in exactly ONE bucket
// (partition, never copy), the same move-semantics discipline as the attention
// queue.
import type { AdminDriverRow, DriverDbStatus } from '@fleet/sync-protocol';
import { classifyDriverDbStatus } from '@fleet/sync-protocol';
import {
  presentDriverDbStatus,
  type DriverDbStatusTone,
} from '@/features/admin/co-so-du-lieu.presenter';

// The status-column inputs the table cell renders for one driver row.
export interface DriverStatusCell {
  readonly status: DriverDbStatus;
  readonly label: string;
  readonly tone: DriverDbStatusTone;
}

// One row -> its status cell. classifyDriverDbStatus reads exactly the two facts
// it needs (assignedVehicle + devices); AdminDriverRow satisfies that shape.
export function toDriverStatusCell(row: AdminDriverRow): DriverStatusCell {
  const status = classifyDriverDbStatus({
    assignedVehicle: row.assignedVehicle,
    devices: row.devices,
  });
  const { label, tone } = presentDriverDbStatus(status);
  return { status, label, tone };
}

// Drivers grouped into exactly one bucket each, keyed by the three statuses in
// badge order. Order within a bucket preserves input order (stable for the
// table). Buckets are always present (empty arrays), so callers never branch on
// undefined.
export interface DriversByStatus {
  readonly unassigned: readonly AdminDriverRow[];
  readonly assigned: readonly AdminDriverRow[];
  readonly active: readonly AdminDriverRow[];
}

export function partitionDriversByStatus(rows: readonly AdminDriverRow[]): DriversByStatus {
  const unassigned: AdminDriverRow[] = [];
  const assigned: AdminDriverRow[] = [];
  const active: AdminDriverRow[] = [];
  for (const row of rows) {
    const status = classifyDriverDbStatus({
      assignedVehicle: row.assignedVehicle,
      devices: row.devices,
    });
    if (status === 'unassigned') unassigned.push(row);
    else if (status === 'assigned') assigned.push(row);
    else active.push(row);
  }
  return { unassigned, assigned, active };
}

// apps/ops-web/src/features/admin/co-so-du-lieu-driver-columns.tsx
// Driver-section column definitions for the Co so du lieu DataTable. The first
// real consumer wiring the whole vertical: AdminDriverRow (SSOT) ->
// toDriverStatusCell (classifier + presenter) -> StatusBadge. Columns:
// Tai xe (fullName), SDT (phone; em dash when null), Xe (plate or Chua giao
// when unassigned), Trang thai (status badge). Vietnamese header + fallback
// strings are immutable UI contracts. Kept as a ColumnDef array (not JSX) so
// the generic DataTable renders it; cells that need DOM identity for tests
// carry a stable data-testid keyed by driverId.
import type { ColumnDef } from '@tanstack/react-table';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { toDriverStatusCell } from '@/features/admin/co-so-du-lieu-row';
import { StatusBadge } from '@/features/admin/StatusBadge';

const EM_DASH = '—';

export const driverColumns: ColumnDef<AdminDriverRow>[] = [
  {
    accessorKey: 'fullName',
    header: 'Tài xế',
  },
  {
    id: 'phone',
    header: 'SĐT',
    accessorFn: (row) => row.phone,
    cell: (ctx) => {
      const row = ctx.row.original;
      return (
        <span data-testid={'driver-phone-' + row.driverId}>
          {row.phone ?? EM_DASH}
        </span>
      );
    },
  },
  {
    id: 'vehicle',
    header: 'Xe',
    accessorFn: (row) => row.assignedVehicle?.plate ?? null,
    cell: (ctx) => {
      const row = ctx.row.original;
      return (
        <span data-testid={'driver-vehicle-' + row.driverId}>
          {row.assignedVehicle?.plate ?? 'Chưa giao'}
        </span>
      );
    },
  },
  {
    id: 'status',
    header: 'Trạng thái',
    cell: (ctx) => {
      const cell = toDriverStatusCell(ctx.row.original);
      return <StatusBadge tone={cell.tone} label={cell.label} />;
    },
  },
];

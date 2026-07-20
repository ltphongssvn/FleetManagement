// apps/ops-web/src/features/admin/co-so-du-lieu-driver-columns.tsx
// Driver-section column definitions for the Co so du lieu DataTable. The first
// real consumer wiring the whole vertical: AdminDriverRow (SSOT) ->
// toDriverStatusCell (classifier + presenter) -> StatusBadge. Columns:
// Tai xe (fullName), SDT (phone; em dash when null), Xe (plate or Chua giao
// when unassigned), Trang thai (status badge). Vietnamese header + fallback
// strings are immutable UI contracts. Kept as a ColumnDef array (not JSX) so
// the generic DataTable renders it; cells that need DOM identity for tests
// carry a stable data-testid keyed by driverId.
//
// Actions column: an UNASSIGNED row shows a Phan cong nhanh button that calls
// meta.onQuickAssign(driverId). The handler is read from the table meta
// (ctx.table.options.meta) -- the TanStack-endorsed way to pass a row-action
// callback into a static column array -- so driverColumns stays a plain,
// importable constant and the section injects behaviour via <DataTable meta>.
import type { ColumnDef } from '@tanstack/react-table';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { toDriverStatusCell } from '@/features/admin/co-so-du-lieu-row';
import { StatusBadge } from '@/features/admin/StatusBadge';

// Shape of the meta the drivers table forwards. Read defensively in the cell
// (optional) so driverColumns is valid even where no meta is provided (e.g.
// the column-def unit test renders columns without a table).
export interface DriverColumnsMeta {
  readonly onQuickAssign?: (driverId: string) => void;
}

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
  {
    id: 'actions',
    header: '',
    enableGlobalFilter: false,
    cell: (ctx) => {
      const drv = ctx.row.original;
      const assigned = drv.assignedVehicle !== null;
      if (assigned) return null;
      const meta = ctx.table.options.meta as DriverColumnsMeta | undefined;
      const onQuickAssign = meta?.onQuickAssign;
      if (onQuickAssign === undefined) return null;
      return (
        <button
          type='button'
          data-testid={'quick-assign-' + drv.driverId}
          onClick={() => { onQuickAssign(drv.driverId); }}
          className='rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700'
        >
          Phân công nhanh
        </button>
      );
    },
  },
];

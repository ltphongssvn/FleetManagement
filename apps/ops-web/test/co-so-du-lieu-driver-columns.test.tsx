// apps/ops-web/test/co-so-du-lieu-driver-columns.test.tsx
// RED-first for the driver-section column definitions the Co so du lieu page
// feeds into DataTable. This is the first REAL consumer wiring the whole
// vertical: AdminDriverRow (SSOT) -> toDriverStatusCell (classifier+presenter)
// -> StatusBadge, rendered as a ColumnDef<AdminDriverRow> array. Columns:
// Tai xe (fullName), SDT (phone, em dash when null), Xe (plate or Chua giao),
// Trang thai (StatusBadge cell). Vietnamese strings are immutable contracts.
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { DataTable } from '@/features/admin/DataTable';
import { driverColumns } from '@/features/admin/co-so-du-lieu-driver-columns';

const vehicle = { vehicleId: 'v1', plate: '62H 05194' };
const liveDevice = {
  deviceId: 'd1',
  platform: 'android',
  appVersion: '1.4.0',
  lastSeenAt: null,
  udid: null,
};

const driver = (over: Partial<AdminDriverRow>): AdminDriverRow => ({
  driverId: 'dr1',
  fullName: 'LE VAN CHAU',
  phone: null,
  operatorId: null,
  assignedVehicle: null,
  assignmentId: null,
  devices: [],
  ...over,
});

describe('driverColumns', () => {
  it('renders driver name, phone, plate and an active status badge', () => {
    const rows = [driver({ phone: '0900000001', assignedVehicle: vehicle, devices: [liveDevice] })];
    render(<DataTable columns={driverColumns} data={rows} />);
    expect(screen.getByText('LE VAN CHAU')).toBeInTheDocument();
    expect(screen.getByText('0900000001')).toBeInTheDocument();
    expect(screen.getByText('62H 05194')).toBeInTheDocument();
    expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();
  });

  it('shows an em dash for a null phone', () => {
    const rows = [driver({ phone: null })];
    render(<DataTable columns={driverColumns} data={rows} />);
    expect(screen.getByTestId('driver-phone-dr1')).toHaveTextContent('—');
  });

  it('shows Chua giao when no vehicle is assigned', () => {
    const rows = [driver({ assignedVehicle: null })];
    render(<DataTable columns={driverColumns} data={rows} />);
    expect(screen.getByTestId('driver-vehicle-dr1')).toHaveTextContent('Chưa giao');
    expect(screen.getByText('Chưa phân công')).toBeInTheDocument();
  });

  it('filters driver rows by plate via global search (exercises accessorFns)', () => {
    const rows = [
      driver({
        driverId: 'a',
        fullName: 'ALPHA',
        phone: '0900000001',
        assignedVehicle: vehicle,
        devices: [liveDevice],
      }),
      driver({
        driverId: 'b',
        fullName: 'BETA',
        phone: '0900000002',
        assignedVehicle: { vehicleId: 'v2', plate: '99Z 00000' },
      }),
      driver({ driverId: 'c', fullName: 'GAMMA', phone: null, assignedVehicle: null }),
    ];
    render(<DataTable columns={driverColumns} data={rows} />);
    fireEvent.change(screen.getByTestId('datatable-search'), { target: { value: '62H 05194' } });
    expect(screen.getByText('ALPHA')).toBeInTheDocument();
    expect(screen.queryByText('BETA')).not.toBeInTheDocument();
    expect(screen.queryByText('GAMMA')).not.toBeInTheDocument();
  });
});

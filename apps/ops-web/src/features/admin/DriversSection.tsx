// apps/ops-web/src/features/admin/DriversSection.tsx
// Drivers section of the Co so du lieu page. Loads AdminDriverRow[] via
// AdminDriversClient.list() and renders them through the generic DataTable with
// driverColumns. The whole vertical (SSOT -> classifier -> presenter ->
// StatusBadge -> columns -> table) is mounted as one section.
//
// Phan cong nhanh (pain point #1): an UNASSIGNED row shows a quick-assign action
// (wired via DataTable meta -> driverColumns actions cell). Clicking it loads
// the available vehicles and opens QuickAssignModal; confirming assigns the
// chosen vehicle and refreshes the list. The driverId comes from the row; the
// modal contributes the vehicleId; the client POSTs {driverId, vehicleId}. No
// raw uuid reaches the dispatcher -- vehicles are ReferenceItem (id = uuid,
// label = plate) and the modal renders the plate.
//
// The client is injectable so tests mock the reads/writes without global fetch.
// list is required; listVehicles + assign are OPTIONAL so the original list-only
// contract (and its tests) is untouched -- quick-assign simply does not arm when
// they are absent. Production defaults to a real AdminDriversClient +
// ReferenceAdminClient for vehicles.
'use client';
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { AdminDriverRow, ReferenceItem } from '@fleet/sync-protocol';
import { AdminDriversClient } from '@/features/admin/admin-drivers-client';
import { ReferenceAdminClient } from '@/features/admin/reference-admin-client';
import { DataTable } from '@/features/admin/DataTable';
import { driverColumns, type DriverColumnsMeta } from '@/features/admin/co-so-du-lieu-driver-columns';
import { QuickAssignModal } from '@/features/admin/QuickAssignModal';
// The section reads the driver list and (optionally) lists vehicles + assigns.
export interface DriversDataClient {
  list: () => Promise<readonly AdminDriverRow[]>;
  listVehicles?: () => Promise<readonly ReferenceItem[]>;
  assign?: (input: { driverId: string; vehicleId: string }) => Promise<unknown>;
}
function makeDefaultClient(): DriversDataClient {
  const drivers = new AdminDriversClient({});
  const vehicles = new ReferenceAdminClient('vehicles');
  return {
    list: () => drivers.list(),
    listVehicles: () => vehicles.list(undefined, 'admin'),
    assign: (input) => drivers.assign(input),
  };
}
type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'loaded'; readonly rows: readonly AdminDriverRow[] };
export interface DriversSectionProps {
  readonly client?: DriversDataClient;
}
export function DriversSection({ client }: DriversSectionProps): JSX.Element {
  const [dataClient] = useState<DriversDataClient>(() => client ?? makeDefaultClient());
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [modalDriver, setModalDriver] = useState<AdminDriverRow | null>(null);
  const [vehicles, setVehicles] = useState<readonly ReferenceItem[]>([]);
  const load = useCallback((): (() => void) => {
    let active = true;
    dataClient
      .list()
      .then((rows) => {
        if (active) setState({ kind: 'loaded', rows });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => { active = false; };
  }, [dataClient]);
  useEffect(() => load(), [load]);
  const canQuickAssign = dataClient.listVehicles !== undefined && dataClient.assign !== undefined;
  const openQuickAssign = useCallback(
    (driverId: string): void => {
      /* v8 ignore next -- action only renders in the loaded state; defensive */
      if (state.kind !== 'loaded') return;
      const driver = state.rows.find((r) => r.driverId === driverId) ?? null;
      /* v8 ignore next -- driverId comes from a rendered row; always found */
      if (driver === null) return;
      const listVehicles = dataClient.listVehicles;
      /* v8 ignore next -- only wired when canQuickAssign (listVehicles set) */
      if (listVehicles === undefined) return;
      setModalDriver(driver);
      void listVehicles().then((vs) => { setVehicles(vs); });
    },
    [state, dataClient],
  );
  const closeModal = useCallback((): void => {
    setModalDriver(null);
    setVehicles([]);
  }, []);
  const confirmAssign = useCallback(
    (vehicleId: string): void => {
      const assign = dataClient.assign;
      /* v8 ignore next -- confirm fires only from an open, armed modal */
      if (modalDriver === null || assign === undefined) return;
      void assign({ driverId: modalDriver.driverId, vehicleId }).then(() => {
        closeModal();
        load();
      });
    },
    [modalDriver, dataClient, closeModal, load],
  );
  if (state.kind === 'loading') {
    return (
      <div data-testid='drivers-section-loading' className='p-4 text-sm text-slate-500'>
        Đang tải dữ liệu...
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div data-testid='drivers-section-error' className='p-4 text-sm text-red-600'>
        Không tải được danh sách tài xế.
      </div>
    );
  }
  // exactOptionalPropertyTypes: OMIT the key when disarmed rather than set it
  // to undefined (an optional prop may be absent, not explicitly undefined).
  const meta: DriverColumnsMeta = canQuickAssign
    ? { onQuickAssign: openQuickAssign }
    : {};
  return (
    <>
      <DataTable columns={driverColumns} data={state.rows} meta={meta} />
      {modalDriver !== null ? (
        <QuickAssignModal
          open
          driverName={modalDriver.fullName}
          vehicles={vehicles}
          onAssign={confirmAssign}
          onClose={closeModal}
        />
      ) : null}
    </>
  );
}

// apps/ops-web/src/features/admin/DriversAdminSection.tsx
// Full driver CRUD surface (register + assign vehicle + revoke + delete + edit
// phone + reset password) with the XState v5 driver-attention queue. Extracted
// verbatim from the old /admin/drivers page body (minus page chrome) so BOTH the
// old page and the new Co so du lieu page render the SAME component -- no
// duplication. Device enrollment is NOT here: devices self-enroll via the app
// (T7). Each mutation refreshes + busts the Router Cache + revalidates dispatch.
// VN copy is immutable production contract.
//
// Vehicle dropdown loads /api/reference/vehicles and PARSES the response with
// the sync-protocol SSOT (ReferenceListResponseSchema) at the trust boundary --
// never an as-cast (the reference-contract header documents what cast-not-parse
// cost at the t5b incident).
//
// STABLE CELL IDENTITY (root fix): DataTable renders every cell through
// flexRender, which does createElement(cellFn, ctx). A cell function rebuilt on
// each render is therefore a NEW element type, so React unmounts and remounts
// the entire cell subtree instead of updating it -- which destroys focus,
// selection and IME composition in the inline phone input while a dispatcher is
// typing, and detaches nodes mid-assertion in tests. Column defs live at module
// scope (TanStack: columns/data need stable references) and reach the
// per-render handlers through context rather than closure capture; memoising
// them in-component could not work, since renderOpsControls closes over
// phoneEdits and changes on every keystroke.
'use client';
import { createContext, useContext, useEffect, useState, type JSX } from 'react';
import { useMachine } from '@xstate/react';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { ReferenceListResponseSchema } from '@fleet/sync-protocol';
import { vnExceptionMessage } from '@/features/errors/present-problem';
import {
  isSessionExpired,
  navigateToSessionRefresh,
} from '@/features/auth/session-refresh-navigation';
import { useRouter } from 'next/navigation';
import { revalidateDispatch } from '@/features/admin/revalidate-dispatch.action';
import { AdminDriversClient } from '@/features/admin/admin-drivers-client';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
import {
  driverAttentionMachine,
  type DriverAttentionEntry,
} from '@/features/admin/driver-attention.machine';
import {
  DRIVER_ATTENTION_QUEUE_HEADING,
  presentDriverAttentionReason,
} from '@/features/admin/driver-attention.presenter';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/features/admin/DataTable';
import { RowActionMenu } from '@/features/admin/RowActionMenu';
interface VehicleOption { vehicleId: string; plate: string; }
interface CreateFormState {
  fullName: string;
  phone: string;
  password: string;
  submitting: boolean;
  error: string | null;
}
const EMPTY_CREATE_FORM: CreateFormState = {
  fullName: '',
  phone: '',
  password: '',
  submitting: false,
  error: null,
};
// Injectable client seam (mirrors DriversSection): tests pass a fake list()
// so the XState machine reaches a terminal state without global fetch. Prod
// path defaults to a real AdminDriversClient.
export interface DriversAdminClient {
  list: AdminDriversClient['list'];
  create: AdminDriversClient['create'];
  update: AdminDriversClient['update'];
  remove: AdminDriversClient['remove'];
  assign: AdminDriversClient['assign'];
  revoke: AdminDriversClient['revoke'];
  resetPassword: AdminDriversClient['resetPassword'];
}
// Internal, single-use, non-duplicated shape crossing no trust boundary:
// plain TS by the two-axis rule (Zod here would be redundant validation).
interface DriverRowRenderers {
  readonly renderAssignControls: (row: AdminDriverRow) => JSX.Element;
  readonly renderOpsControls: (row: AdminDriverRow) => JSX.Element;
}
const DriverRowRenderersContext = createContext<DriverRowRenderers | null>(null);
function useDriverRowRenderers(): DriverRowRenderers {
  const renderers = useContext(DriverRowRenderersContext);
  if (renderers === null) throw new Error('DriverRowRenderers not provided');
  return renderers;
}
function DriverNameCell({ row }: CellContext<AdminDriverRow, unknown>): JSX.Element {
  return (
    <>
      <div className='font-medium'>{row.original.fullName}</div>
      <div className='text-xs text-gray-700'>{row.original.phone}</div>
    </>
  );
}
function DriverVehicleCell({ row }: CellContext<AdminDriverRow, unknown>): JSX.Element {
  // configured rows always carry a vehicle: classifyDriverAttention routes
  // vehicle-less rows to the attention queue (VEHICLE_UNASSIGNED).
  return (
    <span data-testid={'driver-assigned-plate-' + row.original.driverId} className='inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-sm'>{row.original.assignedVehicle?.plate}</span>
  );
}
function DriverDevicesCell({ row }: CellContext<AdminDriverRow, unknown>): JSX.Element {
  // configured rows always carry >=1 device (DEVICE_UNREGISTERED routes the
  // rest to the attention queue), so there is no empty-state arm here.
  return (
    <span className='inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-sm'>
      {row.original.devices.length > 1 ? 'Đã đăng ký (' + String(row.original.devices.length) + ')' : 'Đã đăng ký'}
    </span>
  );
}
function DriverAssignCell({ row }: CellContext<AdminDriverRow, unknown>): JSX.Element {
  return useDriverRowRenderers().renderAssignControls(row.original);
}
function DriverOpsCell({ row }: CellContext<AdminDriverRow, unknown>): JSX.Element {
  return useDriverRowRenderers().renderOpsControls(row.original);
}
const CONFIGURED_COLUMNS: ColumnDef<AdminDriverRow>[] = [
  { accessorKey: 'fullName', header: 'Tài xế', cell: DriverNameCell },
  {
    id: 'vehicle', header: 'Xe được giao',
    accessorFn: (row) => row.assignedVehicle?.plate ?? null,
    cell: DriverVehicleCell,
  },
  { id: 'devices', header: 'Thiết bị', cell: DriverDevicesCell },
  { id: 'assign', header: 'Phân công xe', cell: DriverAssignCell },
  { id: 'ops', header: 'Thao tác', cell: DriverOpsCell },
];
export function DriversAdminSection({ client: injected }: { client?: DriversAdminClient } = {}): JSX.Element {
  const [snapshot, send] = useMachine(driverAttentionMachine);
  const router = useRouter();
  const [vehicleSelect, setVehicleSelect] = useState<Record<string, string>>({});
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({});
  const [resetMsg, setResetMsg] = useState<Record<string, string>>({});
  const [vehicles, setVehicles] = useState<readonly VehicleOption[]>([]);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [busy, setBusy] = useState(false);
  const client: DriversAdminClient = injected ?? new AdminDriversClient({});
  const refresh = async (): Promise<void> => {
    try {
      const rows = await client.list();
      send({ type: 'LOADED', rows });
    } catch (e) {
      if (isSessionExpired(e)) {
        navigateToSessionRefresh();
        return;
      }
      send({ type: 'ERROR', message: vnExceptionMessage(e, 'load failed') });
    }
  };
  useRefetchOnFocus(() => { void refresh(); });
  const loadVehicles = async (): Promise<void> => {
    try {
      const res = await fetch('/api/reference/vehicles?scope=admin');
      if (res.ok) {
        const parsed = ReferenceListResponseSchema.safeParse(await res.json());
        const items = parsed.success ? parsed.data.items : [];
        setVehicles(items.map((it) => ({ vehicleId: it.id, plate: it.label })));
      }
    } catch { /* ignore */ }
  };
  useEffect(() => {
    void refresh();
    void loadVehicles();
  }, []);
  const handleCreateDriver = async (): Promise<void> => {
    if (createForm.fullName.length === 0 || createForm.phone.length < 8 || createForm.password.length < 6) {
      setCreateForm((f) => ({ ...f, error: 'Vui lòng nhập đầy đủ Họ tên, Số điện thoại (≥8), Mật khẩu (≥6)' }));
      return;
    }
    setCreateForm((f) => ({ ...f, submitting: true, error: null }));
    try {
      await client.create({
        fullName: createForm.fullName,
        phone: createForm.phone,
        password: createForm.password,
      });
      setCreateForm(EMPTY_CREATE_FORM);
      await refresh();
      router.refresh();
      await revalidateDispatch();
    } catch (e) {
      setCreateForm((f) => ({
        ...f,
        submitting: false,
        error: vnExceptionMessage(e, 'tạo tài xế thất bại'),
      }));
    }
  };
  const handleAssign = async (driverId: string): Promise<void> => {
    const vehicleId = vehicleSelect[driverId];
    if (vehicleId === undefined || vehicleId.length === 0) { alert('Vui lòng chọn xe'); return; }
    try {
      await client.assign({ driverId, vehicleId });
      await refresh();
      router.refresh();
      await revalidateDispatch();
    } catch (e) {
      alert(vnExceptionMessage(e, 'assign failed'));
    }
  };
  const handleRevoke = async (assignmentId: string): Promise<void> => {
    const reason = window.prompt('Lý do hủy phân công?', 'driver_left');
    if (reason === null || reason.length === 0) return;
    try {
      await client.revoke(assignmentId, reason);
      await refresh();
      router.refresh();
      await revalidateDispatch();
    } catch (e) {
      alert(vnExceptionMessage(e, 'revoke failed'));
    }
  };
  const handleDelete = async (row: AdminDriverRow): Promise<void> => {
    setBusy(true);
    try {
      await client.remove(row.driverId);
      await refresh();
      router.refresh();
      await revalidateDispatch();
    } catch (e) {
      alert(vnExceptionMessage(e, 'delete failed'));
    } finally {
      setBusy(false);
    }
  };
  const handleSavePhone = async (row: AdminDriverRow): Promise<void> => {
    const next = phoneEdits[row.driverId] ?? row.phone ?? '';
    setBusy(true);
    try {
      await client.update(row.driverId, { fullName: row.fullName, phone: next });
      await refresh();
      router.refresh();
      await revalidateDispatch();
    } catch (e) {
      alert(vnExceptionMessage(e, 'update phone failed'));
    } finally {
      setBusy(false);
    }
  };
  const handleResetPassword = async (row: AdminDriverRow): Promise<void> => {
    const next = window.prompt('Mật khẩu mới cho ' + row.fullName + ' (≥ 6 ký tự):', '');
    if (next === null) return;
    if (next.length < 6) { alert('Mật khẩu mới phải có ít nhất 6 ký tự'); return; }
    setBusy(true);
    try {
      await client.resetPassword(row.driverId, next);
      setResetMsg((m) => ({ ...m, [row.driverId]: 'Đã đặt lại mật khẩu' }));
    } catch (e) {
      alert(vnExceptionMessage(e, 'đặt lại mật khẩu thất bại'));
    } finally {
      setBusy(false);
    }
  };
  const renderAssignControls = (row: AdminDriverRow): JSX.Element => (
    row.assignmentId !== null ? (
      <button
        type='button'
        data-testid={'driver-revoke-' + row.driverId}
        onClick={() => { void handleRevoke(row.assignmentId ?? ''); }}
        className='bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm w-fit'
      >
        Hủy phân công
      </button>
    ) : (
      <div className='flex flex-col gap-2'>
        <select
          data-testid={'driver-assign-vehicle-' + row.driverId}
          value={vehicleSelect[row.driverId] ?? ''}
          onChange={(e) => { setVehicleSelect((m) => ({ ...m, [row.driverId]: e.target.value })); }}
          className='border rounded px-2 py-1 text-sm w-72'
        >
          <option value=''>— Chọn số xe —</option>
          {vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>{v.plate}</option>
          ))}
        </select>
        <button
          type='button'
          data-testid={'driver-assign-submit-' + row.driverId}
          onClick={() => { void handleAssign(row.driverId); }}
          className='bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm w-fit'
        >
          Phân công
        </button>
      </div>
    )
  );
  const renderOpsControls = (row: AdminDriverRow): JSX.Element => (
    <div className='flex items-center gap-2'>
      <input
        type='text'
        aria-label={'Số điện thoại của ' + row.fullName}
        value={phoneEdits[row.driverId] ?? row.phone ?? ''}
        onChange={(e) => { setPhoneEdits((m) => ({ ...m, [row.driverId]: e.target.value })); }}
        className='w-32 rounded border px-2 py-1 text-sm'
      />
      <button
        type='button'
        disabled={busy}
        aria-label={'Lưu SĐT của ' + row.fullName}
        onClick={() => { void handleSavePhone(row); }}
        className='rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600 disabled:bg-gray-400'
      >
        Lưu SĐT
      </button>
      <RowActionMenu
        label={'Thao tác cho ' + row.fullName}
        actions={[
          {
            key: 'reset-password',
            label: 'Đặt lại mật khẩu',
            disabled: busy,
            onSelect: () => { void handleResetPassword(row); },
          },
          {
            key: 'delete',
            label: 'Xóa',
            destructive: true,
            disabled: busy,
            confirmLabel: 'Xóa tài xế ' + row.fullName + ' ?',
            onSelect: () => { void handleDelete(row); },
          },
        ]}
      />
      {resetMsg[row.driverId] !== undefined ? (
        <span className='self-center text-sm text-green-700'>{resetMsg[row.driverId]}</span>
      ) : null}
    </div>
  );
  const rowRenderers: DriverRowRenderers = { renderAssignControls, renderOpsControls };
  if (snapshot.matches('loading')) return <div data-testid='drivers-section-loading' className='py-4 text-sm text-slate-500'>Đang tải…</div>;
  if (snapshot.matches('error')) return <div className='py-4 text-red-600'>Lỗi: {snapshot.context.errorMessage}</div>;
  const attention: readonly DriverAttentionEntry[] = snapshot.context.attention;
  const configured: readonly AdminDriverRow[] = snapshot.context.configured;
  return (
    <div>
      <section className='mb-8 p-4 border rounded bg-gray-50'>
        <h3 className='text-lg font-semibold mb-3'>Đăng ký tài xế mới</h3>
        <div className='flex flex-wrap gap-2 items-end'>
          <div>
            <label className='block text-sm text-gray-700 mb-1'>Họ và tên</label>
            <input
              type='text'
              value={createForm.fullName}
              onChange={(e) => { setCreateForm((f) => ({ ...f, fullName: e.target.value, error: null })); }}
              className='border rounded px-2 py-1 text-sm w-64'
              placeholder='Nguyễn Văn A'
            />
          </div>
          <div>
            <label className='block text-sm text-gray-700 mb-1'>Số điện thoại</label>
            <input
              type='tel'
              value={createForm.phone}
              onChange={(e) => { setCreateForm((f) => ({ ...f, phone: e.target.value, error: null })); }}
              className='border rounded px-2 py-1 text-sm w-48'
              placeholder='+84901000001'
            />
          </div>
          <div>
            <label className='block text-sm text-gray-700 mb-1'>Mật khẩu</label>
            <input
              type='password'
              value={createForm.password}
              onChange={(e) => { setCreateForm((f) => ({ ...f, password: e.target.value, error: null })); }}
              className='border rounded px-2 py-1 text-sm w-48'
              placeholder='≥ 6 ký tự'
            />
          </div>
          <button
            type='button'
            disabled={createForm.submitting}
            onClick={() => { void handleCreateDriver(); }}
            className='bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-1 rounded text-sm h-fit'
          >
            {createForm.submitting ? 'Đang tạo…' : 'Đăng ký tài xế'}
          </button>
        </div>
        {createForm.error !== null ? (
          <div className='mt-2 text-red-600 text-sm'>{createForm.error}</div>
        ) : null}
      </section>
      {snapshot.matches({ ready: 'attention' }) ? (
        <section aria-label={DRIVER_ATTENTION_QUEUE_HEADING} className='mb-8 p-4 border-2 border-amber-400 rounded bg-amber-50'>
          <h3 className='text-lg font-semibold mb-3'>{DRIVER_ATTENTION_QUEUE_HEADING}</h3>
          <ul className='flex flex-col gap-4'>
            {attention.map((entry) => (
              <li key={entry.row.driverId} className='p-3 border rounded bg-white'>
                <div className='flex flex-wrap gap-4 items-start'>
                  <div className='w-48'>
                    <div className='font-medium'>{entry.row.fullName}</div>
                    <div className='text-xs text-gray-700'>{entry.row.phone}</div>
                    {entry.row.assignedVehicle ? (
                      <span data-testid={'driver-assigned-plate-' + entry.row.driverId} className='inline-block mt-1 bg-green-100 text-green-800 px-2 py-1 rounded text-sm'>
                        {entry.row.assignedVehicle.plate}
                      </span>
                    ) : null}
                  </div>
                  <div className='w-80'>
                    {entry.reasons.map((code) => {
                      const p = presentDriverAttentionReason(code);
                      return (
                        <div key={code} className='mb-2'>
                          <span className='inline-block bg-amber-200 text-amber-900 px-2 py-1 rounded text-sm'>{p.label}</span>
                          <div className='text-xs text-gray-700 mt-1'>{p.hint}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className='flex flex-col gap-2'>
                    {renderAssignControls(entry.row)}
                    {renderOpsControls(entry.row)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <DriverRowRenderersContext.Provider value={rowRenderers}>
        <DataTable
          columns={CONFIGURED_COLUMNS}
          data={configured}
          caption='Tài xế'
          emptyLabel='Chưa có tài xế'
        />
      </DriverRowRenderersContext.Provider>
    </div>
  );
}

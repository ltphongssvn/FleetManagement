// apps/ops-web/src/app/admin/drivers/page.tsx
// Drivers admin CRUD UI. Pattern mirrors /admin/reference.
//
// T5: removed redundant 'Sửa' (inline rename) per-row control and its
// supporting state (editId/editName/Lưu/Hủy + saveEdit/cancelEdit/
// startEdit + client.update plumbing in this page). Xóa + re-create
// supersedes rename safely. The Thao tác column now only renders the
// Xóa button per row.
'use client';
import { useEffect, useReducer, useState, type JSX } from 'react';
import { AdminDriversClient } from '../../../features/admin/admin-drivers-client';
import {
  reduceAdminDriversState,
  type DriverRow,
} from '../../../features/admin/drivers-state';
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
export default function AdminDriversPage(): JSX.Element {
  const [state, dispatch] = useReducer(reduceAdminDriversState, { kind: 'loading' });
  const [vehicleSelect, setVehicleSelect] = useState<Record<string, string>>({});
  const [deviceIdInput, setDeviceIdInput] = useState<Record<string, string>>({});
  const [vehicles, setVehicles] = useState<readonly VehicleOption[]>([]);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [busy, setBusy] = useState(false);
  const client = new AdminDriversClient({
    apiUrl: '',
    bearerToken: (): string => '',
  });
  const refresh = async (): Promise<void> => {
    try {
      const rows = await client.list();
      dispatch({ type: 'loaded', rows });
    } catch (e) {
      dispatch({ type: 'error', message: e instanceof Error ? e.message : 'load failed' });
    }
  };
  const loadVehicles = async (): Promise<void> => {
    try {
      const res = await fetch('/api/reference/vehicles?scope=admin');
      if (res.ok) {
        const data = await res.json() as { items?: { id: string; label: string }[] };
        const list = (data.items ?? []).map((it) => ({ vehicleId: it.id, plate: it.label }));
        setVehicles(list);
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
    } catch (e) {
      setCreateForm((f) => ({
        ...f,
        submitting: false,
        error: e instanceof Error ? e.message : 'tạo tài xế thất bại',
      }));
    }
  };
  const handleAssignAndEnroll = async (driverId: string): Promise<void> => {
    const vehicleId = vehicleSelect[driverId];
    const deviceId = deviceIdInput[driverId];
    if (vehicleId === undefined || vehicleId.length === 0) { alert('Vui lòng chọn xe'); return; }
    if (deviceId === undefined || deviceId.length === 0) { alert('Vui lòng nhập mã thiết bị (UDID)'); return; }
    try {
      await client.assign({ driverId, vehicleId });
      await client.enrollDevice({ driverId, udid: deviceId, platform: 'ios' });
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'assign failed');
    }
  };
  const handleRevoke = async (assignmentId: string): Promise<void> => {
    const reason = window.prompt('Lý do hủy phân công?', 'driver_left');
    if (reason === null || reason.length === 0) return;
    try {
      await client.revoke(assignmentId, reason);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'revoke failed');
    }
  };
  const handleDelete = async (row: DriverRow): Promise<void> => {
    if (!window.confirm('Xóa tài xế ' + row.fullName + '?')) return;
    setBusy(true);
    try {
      await client.remove(row.driverId);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };
  if (state.kind === 'loading') return <div className='p-6'>Đang tải…</div>;
  if (state.kind === 'error') return <div className='p-6 text-red-600'>Lỗi: {state.message}</div>;
  // Defensive narrowing: TypeScript can prove rows exists here, but a
  // concurrent strict-mode re-render in tests can observe the function
  // body with state pointing at the previous 'loading' snapshot before the
  // early returns above evaluate. Bind rows once via narrowing so the
  // JSX below references a guaranteed array.
  const rows: readonly DriverRow[] = state.rows;
  return (
    <div className='p-6'>
      <div className='mb-4'><a href='/' className='text-blue-600 hover:underline text-sm'>← Quay lại Bảng điều phối</a></div>
      <h1 className='text-2xl font-semibold mb-6'>Quản lý tài xế &amp; xe</h1>
      <section className='mb-8 p-4 border rounded bg-gray-50'>
        <h2 className='text-lg font-semibold mb-3'>Đăng ký tài xế mới</h2>
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
      <table className='w-full border-collapse'>
        <thead>
          <tr className='border-b bg-gray-50'>
            <th className='text-left p-2'>Tài xế</th>
            <th className='text-left p-2'>Xe được giao</th>
            <th className='text-left p-2'>Thiết bị</th>
            <th className='text-left p-2'>Phân công xe &amp; đăng ký thiết bị</th>
            <th className='text-left p-2'>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: DriverRow) => (
            <tr key={row.driverId} className='border-b'>
              <td className='p-2'>
                <div className='font-medium'>{row.fullName}</div>
                <div className='text-xs text-gray-500'>{row.operatorId ?? '—'}</div>
              </td>
              <td className='p-2'>
                {row.assignedVehicle ? (
                  <span className='inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-sm'>
                    {row.assignedVehicle.plate}
                  </span>
                ) : (
                  <span className='text-gray-400'>— Chưa giao —</span>
                )}
              </td>
              <td className='p-2'>
                {row.devices.length === 0 ? (
                  <span className='text-amber-600 text-sm'>Chưa đăng ký</span>
                ) : (
                  <ul className='text-sm'>
                    {row.devices.map((d) => (
                      <li key={d.deviceId}>
                        {d.udid ?? d.deviceId}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className='p-2'>
                {row.assignmentId !== null ? (
                  <button
                    type='button'
                    onClick={() => { void handleRevoke(row.assignmentId ?? ''); }}
                    className='bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm'
                  >
                    Hủy phân công
                  </button>
                ) : (
                  <div className='flex flex-col gap-2'>
                    <select
                      value={vehicleSelect[row.driverId] ?? ''}
                      onChange={(e) => { setVehicleSelect((m) => ({ ...m, [row.driverId]: e.target.value })); }}
                      className='border rounded px-2 py-1 text-sm w-72'
                    >
                      <option value=''>— Chọn số xe —</option>
                      {vehicles.map((v) => (
                        <option key={v.vehicleId} value={v.vehicleId}>{v.plate}</option>
                      ))}
                    </select>
                    <input
                      type='text'
                      placeholder='Mã thiết bị tài xế (UDID)'
                      value={deviceIdInput[row.driverId] ?? ''}
                      onChange={(e) => { setDeviceIdInput((m) => ({ ...m, [row.driverId]: e.target.value })); }}
                      className='border rounded px-2 py-1 text-sm w-72'
                    />
                    <button
                      type='button'
                      onClick={() => { void handleAssignAndEnroll(row.driverId); }}
                      className='bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm w-fit'
                    >
                      Phân công &amp; đăng ký
                    </button>
                  </div>
                )}
              </td>
              <td className='p-2'>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => { void handleDelete(row); }}
                    className='rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600 disabled:bg-gray-400'
                  >
                    Xóa
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

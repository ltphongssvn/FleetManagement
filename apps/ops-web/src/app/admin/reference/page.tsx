// apps/ops-web/src/app/admin/reference/page.tsx
// CRUD admin for dispatch-form master data: customers (Khách hàng), cargo
// types (Tên hàng), vehicles (Số xe) and warehouses (kho nhan/giao hang).
// Drivers (Tai xe) have their own richer admin page (vehicle assignment +
// device enrollment) linked at the top.
//
// T5: removed redundant 'Sửa' (inline rename) per-row control.
//
// T5c (consistency invariant): when a write fails — most commonly a 409
// 'đã tồn tại' — the section refreshes its row list so the rejected
// item is visible alongside the friendly error banner. The conflicting
// row is highlighted (data-testid + amber ring) and scrolled into view.
// Vehicles (Số xe) uses scope='admin' so the listing returns ALL active
// rows (not the pair-filtered subset the dispatch create-order form uses).
//
// 2026 (Khách hàng Số điện thoại): the customers section additionally
// manages an optional VN domestic phone (e.g. 0901234567, no +84). The add
// form has a Số điện thoại input; each customer row shows its phone and a
// 'Sửa SĐT' control that reveals an inline phone field + 'Lưu' which calls
// client.update(id, name, phone). Phone travels in ReferenceOption.meta.phone.
'use client';
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  ReferenceAdminClient,
  type ReferenceOption,
  type ReferenceSegment,
} from '../../../features/admin/reference-admin-client';
interface SectionDef {
  segment: ReferenceSegment;
  title: string;
  addLabel: string;
  role?: 'pickup' | 'delivery';
  scope?: 'admin';
}
const SECTIONS: SectionDef[] = [
  { segment: 'customers', title: 'Khách hàng', addLabel: 'Thêm khách hàng' },
  { segment: 'cargo-types', title: 'Tên hàng', addLabel: 'Thêm tên hàng' },
  { segment: 'vehicles', title: 'Số xe', addLabel: 'Thêm số xe', scope: 'admin' },
  { segment: 'warehouses', title: 'Kho nhận hàng', addLabel: 'Thêm kho nhận hàng', role: 'pickup' },
  { segment: 'warehouses', title: 'Kho giao hàng', addLabel: 'Thêm kho giao hàng', role: 'delivery' },
];
function extractConflictName(msg: string): string | null {
  const m = /["\u201C\u201D]([^"\u201C\u201D]+)["\u201C\u201D]\s*đã tồn tại/i.exec(msg);
  return m?.[1] ?? null;
}
function rowPhone(row: ReferenceOption): string {
  const p = row.meta?.['phone'];
  return typeof p === 'string' ? p : '';
}
function ReferenceSection({ def }: { def: SectionDef }): JSX.Element {
  const client = new ReferenceAdminClient(def.segment);
  const isCustomers = def.segment === 'customers';
  const [rows, setRows] = useState<readonly ReferenceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflictName, setConflictName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const conflictRowRef = useRef<HTMLLIElement | null>(null);
  const refresh = async (preserveError = false): Promise<void> => {
    setLoading(true);
    try {
      const all = await client.list(def.role, def.scope);
      setRows(all);
      if (!preserveError) {
        setError(null);
        setConflictName(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (conflictName !== null && conflictRowRef.current !== null) {
      const el = conflictRowRef.current;
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [conflictName, rows]);
  const add = async (): Promise<void> => {
    if (newName.trim().length === 0) return;
    setBusy(true);
    try {
      const phoneArg = isCustomers ? (newPhone.trim() === '' ? '' : newPhone.trim()) : undefined;
      await client.create(newName.trim(), def.role, phoneArg);
      setNewName('');
      setNewPhone('');
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'create failed';
      setError(msg);
      setConflictName(extractConflictName(msg) ?? newName.trim());
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string, label: string): Promise<void> => {
    if (!window.confirm('Xóa ' + quote(label) + '?')) return;
    setBusy(true);
    try {
      await client.remove(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const startEdit = (id: string, phone: string): void => {
    setEditingId(id);
    setEditPhone(phone);
  };
  const saveEdit = async (id: string, label: string): Promise<void> => {
    setBusy(true);
    try {
      await client.update(id, label, editPhone.trim() === '' ? '' : editPhone.trim());
      setEditingId(null);
      setEditPhone('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed');
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className='mb-8 rounded border bg-white p-4'>
      <h2 className='mb-3 text-lg font-semibold'>{def.title}</h2>
      {error !== null ? <div className='mb-2 text-sm text-red-600'>{error}</div> : null}
      <div className='mb-3 flex gap-2'>
        <input
          type='text'
          value={newName}
          onChange={(e) => { setNewName(e.target.value); }}
          placeholder={def.addLabel}
          className='w-72 rounded border px-2 py-1 text-sm'
        />
        {isCustomers ? (
          <input
            type='tel'
            value={newPhone}
            onChange={(e) => { setNewPhone(e.target.value); }}
            placeholder='Số điện thoại'
            aria-label='Số điện thoại'
            className='w-48 rounded border px-2 py-1 text-sm'
          />
        ) : null}
        <button
          type='button'
          disabled={busy}
          onClick={() => { void add(); }}
          className='rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:bg-gray-400'
        >
          {def.addLabel}
        </button>
      </div>
      {loading ? (
        <div className='text-sm text-gray-500'>Đang tải…</div>
      ) : (
        <ul className='divide-y'>
          {rows.length === 0 ? (
            <li className='py-2 text-sm text-gray-400'>Chưa có dữ liệu</li>
          ) : null}
          {rows.map((row) => {
            const isConflict = conflictName !== null && row.label === conflictName;
            const phone = rowPhone(row);
            const isEditing = editingId === row.id;
            return (
              <li
                key={row.id}
                ref={isConflict ? conflictRowRef : null}
                data-testid={isConflict ? 'reference-row-conflict' : undefined}
                className={
                  'flex items-center justify-between py-2'
                  + (isConflict ? ' bg-yellow-50 ring-2 ring-amber-300 rounded px-2' : '')
                }
              >
                <span className='flex items-center gap-3 text-sm'>
                  <span>{row.label}</span>
                  {isCustomers && !isEditing && phone !== '' ? (
                    <span className='text-gray-500'>{phone}</span>
                  ) : null}
                  {isCustomers && isEditing ? (
                    <input
                      type='tel'
                      value={editPhone}
                      onChange={(e) => { setEditPhone(e.target.value); }}
                      aria-label='Số điện thoại'
                      className='w-44 rounded border px-2 py-1 text-sm'
                    />
                  ) : null}
                </span>
                <span className='flex gap-2'>
                  {isCustomers && !isEditing ? (
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => { startEdit(row.id, phone); }}
                      className='rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600'
                    >
                      Sửa SĐT
                    </button>
                  ) : null}
                  {isCustomers && isEditing ? (
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => { void saveEdit(row.id, row.label); }}
                      className='rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700'
                    >
                      Lưu
                    </button>
                  ) : null}
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => { void del(row.id, row.label); }}
                    className='rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600'
                  >
                    Xóa
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
function quote(s: string): string {
  return String.fromCharCode(34) + s + String.fromCharCode(34);
}
export default function ReferenceAdminPage(): JSX.Element {
  return (
    <div className='p-6'>
      <div className='mb-4'>
        <a href='/' className='text-sm text-blue-600 hover:underline'>&larr; Quay lại Bảng điều phối</a>
      </div>
      <h1 className='mb-2 text-2xl font-semibold'>Quản lý dữ liệu điều phối</h1>
      <p className='mb-6 text-sm text-gray-600'>
        Thêm, xóa các lựa chọn trong biểu mẫu tạo lệnh.
        {' '}
        <a href='/admin/drivers' className='text-blue-600 hover:underline'>Quản lý tài xế &amp; xe &rarr;</a>
      </p>
      {SECTIONS.map((def) => (
        <ReferenceSection key={def.title} def={def} />
      ))}
    </div>
  );
}

// apps/ops-web/src/features/admin/QuickAssignModal.tsx
// Phan cong nhanh (quick-assign) modal -- Phase 1, pain point #1. Replaces the
// per-row dropdown + UDID input + button that repeated on every unassigned
// driver row with ONE dialog: pick an available vehicle by its human plate,
// confirm once. Vehicle-only (device enrollment removed, #302).
//
// Native <dialog> + showModal(): the browser provides the focus trap, Esc-to-
// close, top-layer stacking and backdrop, so there is no hand-rolled focus
// trap (2026 standard). showModal/close are feature-detected because jsdom
// does not implement them (tests stub them).
//
// No raw UUID reaches the dispatcher (no-raw-UUID-in-UI invariant): each option
// renders the plate (ReferenceItem.label) and carries the vehicleId
// (ReferenceItem.id) only as its value. Submit is guarded by
// parseQuickAssignInput -- confirm is disabled until a valid vehicle is chosen
// AND the click re-parses, so a blank assignment (the old rows failure mode)
// cannot reach onAssign.
'use client';
import { useEffect, useRef, useState, type JSX } from 'react';
import { parseQuickAssignInput, type ReferenceItem } from '@fleet/sync-protocol';
export interface QuickAssignModalProps {
  readonly open: boolean;
  readonly driverName: string;
  readonly vehicles: readonly ReferenceItem[];
  readonly onAssign: (vehicleId: string) => void;
  readonly onClose: () => void;
}
export function QuickAssignModal({
  open,
  driverName,
  vehicles,
  onAssign,
  onClose,
}: QuickAssignModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  useEffect(() => {
    const el = dialogRef.current;
    if (el === null) return;
    if (open && typeof el.showModal === 'function' && !el.open) {
      el.showModal();
    }
    if (!open && typeof el.close === 'function' && el.open) {
      el.close();
    }
  }, [open]);
  const noVehicles = vehicles.length === 0;
  const parsed = parseQuickAssignInput({ vehicleId });
  const canAssign = parsed !== null && !noVehicles;
  const confirm = (): void => {
    const valid = parseQuickAssignInput({ vehicleId });
    if (valid === null) return;
    onAssign(valid.vehicleId);
  };
  return (
    <dialog
      ref={dialogRef}
      data-testid='quick-assign-dialog'
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className='rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40'
    >
      <div className='w-80 space-y-4 p-5'>
        <div>
          <h2 className='text-lg font-semibold text-slate-900'>Phân công nhanh</h2>
          <p className='mt-1 text-sm text-slate-500'>
            Tài xế: <span className='font-medium text-slate-700'>{driverName}</span>
          </p>
        </div>
        {noVehicles ? (
          <p data-testid='quick-assign-empty' className='text-sm text-amber-600'>
            Không có xe khả dụng
          </p>
        ) : (
          <label className='block text-sm'>
            <span className='mb-1 block text-slate-600'>Chọn số xe</span>
            <select
              value={vehicleId}
              onChange={(e) => { setVehicleId(e.target.value); }}
              className='w-full rounded border border-slate-300 px-2 py-1.5 text-sm'
            >
              <option value=''>— Chọn số xe —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={() => { onClose(); }}
            className='rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50'
          >
            Hủy
          </button>
          <button
            type='button'
            disabled={!canAssign}
            onClick={() => { confirm(); }}
            className='rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:bg-gray-400'
          >
            Phân công
          </button>
        </div>
      </div>
    </dialog>
  );
}

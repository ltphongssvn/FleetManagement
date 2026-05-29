// apps/ops-web/src/features/dispatch/ExportOrdersExcelButton.tsx
//
// T1 (2026): Client component that exports the Lệnh điều xe table to .xlsx.
// On click it calls the exportOrdersExcel server action, then triggers a
// browser download from memory by creating a Blob and clicking a synthetic
// anchor. No client-side Excel library — all .xlsx generation happens
// server-side via ExcelJS, keeping the browser bundle small.
'use client';
import { useState, useTransition } from 'react';
import { exportOrdersExcel } from './export-orders-excel.action';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function triggerDownload(bodyBase64: string, filename: string): void {
  const binary = atob(bodyBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes as BlobPart], { type: MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
type ErrState = { message: string } | null;
export function ExportOrdersExcelButton(): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<ErrState>(null);
  function onClick(): void {
    setErr(null);
    startTransition(async () => {
      const result = await exportOrdersExcel();
      if (result.status === 'ok') {
        triggerDownload(result.bodyBase64, result.filename);
        return;
      }
      if (result.status === 'auth_required') {
        setErr({ message: 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.' });
        return;
      }
      setErr({ message: result.message });
    });
  }
  return (
    <span className='inline-flex items-center gap-2'>
      <button
        type='button'
        onClick={onClick}
        disabled={isPending}
        className='inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'
      >
        {isPending ? 'Đang xuất...' : 'Xuất Excel'}
      </button>
      {err !== null && (
        <span role='alert' className='text-sm text-red-700'>{err.message}</span>
      )}
    </span>
  );
}

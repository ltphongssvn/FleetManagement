// apps/ops-web/src/features/dispatch/ExportOrdersExcelButton.tsx
//
// T1 (2026): Client component that exports the Lệnh điều xe table to .xlsx.
// On click it calls the exportOrdersExcel server action, then triggers a
// browser download from memory by creating a Blob and clicking a synthetic
// anchor. No client-side Excel library — all .xlsx generation happens
// server-side via ExcelJS, keeping the browser bundle small.
//
// Date entry (t65, 2026): the two range fields are VnDateField, not native
// date inputs. The native control renders mm/dd/yyyy and an English calendar
// from the BROWSER locale, which application code cannot override, so it was
// the one surface on this screen still showing English to a Vietnamese-only
// dispatcher. VnDateField reports the SAME ISO yyyy-mm-dd string through
// onValueChange that the native onChange produced, so the from/to state, the
// both-ends-set rule below and the ExportDateRange contract are unchanged.
//
// Day-range (Feature 4, 2026): two optional VN-local date inputs (Từ ngày /
// Đến ngày). When BOTH are set, the chosen inclusive [from, to] range is passed
// to the action, which forwards it to the API to bound the export by planned
// date. If either is empty the export covers everything (unchanged behavior).
'use client';
import { useState, useTransition } from 'react';
import { exportOrdersExcel } from './export-orders-excel.action';
import { VnDateField } from './ui/VnDateField';
import type { ExportDateRange } from '@fleet/sync-protocol';
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  function onClick(): void {
    setErr(null);
    // Only send a range when BOTH ends are chosen; a partial range is ambiguous,
    // so it falls back to a full export. The action + API re-validate from<=to.
    const range: ExportDateRange | undefined =
      from !== '' && to !== '' ? { from, to } : undefined;
    startTransition(async () => {
      const result = await exportOrdersExcel(range);
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
      <label className='flex items-center gap-1 text-sm text-slate-600'>
        <span>Từ ngày</span>
        <VnDateField
          name='exportRangeFrom'
          label='Từ ngày'
          testId='export-range-from'
          onValueChange={setFrom}
        />
      </label>
      <label className='flex items-center gap-1 text-sm text-slate-600'>
        <span>Đến ngày</span>
        <VnDateField
          name='exportRangeTo'
          label='Đến ngày'
          testId='export-range-to'
          onValueChange={setTo}
        />
      </label>
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

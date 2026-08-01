// apps/ops-web/src/features/dispatch/ExportOrdersExcelButton.tsx
//
// T1 (2026): Client component that exports the Lệnh điều xe table to .xlsx.
// On click it calls the exportOrdersExcel server action, then triggers a
// browser download from memory by creating a Blob and clicking a synthetic
// anchor. No client-side Excel library — all .xlsx generation happens
// server-side via ExcelJS, keeping the browser bundle small.
//
// Day-range (Feature 4, 2026): two optional VN-local date inputs (Từ ngày /
// Đến ngày). When BOTH are set, the chosen inclusive [from, to] range is passed
// to the action, which forwards it to the API to bound the export by planned
// date. If either is empty the export covers everything (unchanged behavior).
'use client';
import { useState, useTransition } from 'react';
import { exportOrdersExcel } from './export-orders-excel.action';
import type { ExportQuery, RoadRunStatusGroup } from '@fleet/sync-protocol';
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
// T67: the board filter the dispatcher can SEE, handed down from DispatchView.
// Both optional, so an unfiltered board and the daily-backup callers keep the
// previous whole-board behaviour with no change at the call site.
// Both props are declared as explicitly-undefined-able. Under
// exactOptionalPropertyTypes: true an optional key does NOT accept a literal
// undefined, and DispatchView legitimately passes pagination?.group, which is
// RoadRunStatusGroup | undefined whenever the board is unpaginated. Declaring
// the true accepted type is the root fix; narrowing at the call site with a
// conditional spread would only hide the mismatch.
export interface ExportOrdersExcelButtonProps {
  readonly search?: string | undefined;
  readonly group?: RoadRunStatusGroup | undefined;
}
export function ExportOrdersExcelButton(
  props: ExportOrdersExcelButtonProps = {},
): React.ReactElement {
  const { search, group } = props;
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<ErrState>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  function onClick(): void {
    setErr(null);
    // T67: what-you-see-is-what-you-export. The workbook covers the rows the
    // dispatcher is actually looking at -- the active free-text search AND the
    // status tab -- never the whole board behind a filtered view.
    //
    // A range is still sent only when BOTH ends are chosen, but a half range is
    // now rejected by the SSOT instead of silently widening the export back to
    // everything. Empty keys are OMITTED rather than sent blank, so an
    // unfiltered board yields undefined and daily-backup semantics are intact.
    const filter: ExportQuery | undefined = (() => {
      const f: {
        from?: string; to?: string; search?: string; group?: RoadRunStatusGroup;
      } = {};
      if (from !== '' && to !== '') { f.from = from; f.to = to; }
      if (search !== undefined && search !== '') f.search = search;
      if (group !== undefined) f.group = group;
      return Object.keys(f).length === 0 ? undefined : (f as ExportQuery);
    })();
    startTransition(async () => {
      const result = await exportOrdersExcel(filter);
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
        <input
          type='date'
          data-testid='export-range-from'
          value={from}
          onChange={(e) => { setFrom(e.target.value); }}
          className='rounded border border-slate-300 px-2 py-1 text-sm'
        />
      </label>
      <label className='flex items-center gap-1 text-sm text-slate-600'>
        <span>Đến ngày</span>
        <input
          type='date'
          data-testid='export-range-to'
          value={to}
          onChange={(e) => { setTo(e.target.value); }}
          className='rounded border border-slate-300 px-2 py-1 text-sm'
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

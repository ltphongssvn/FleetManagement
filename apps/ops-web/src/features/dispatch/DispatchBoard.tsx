// apps/ops-web/src/features/dispatch/DispatchBoard.tsx
// Renders the dispatcher's daily worklist. T4 invariant: every cell shows a
// human-readable identifier — the dispatcher-entered Số lệnh (XT.NNNN), the
// driver display name, and the vehicle plate — never a raw UUID. Unknown ids
// fall back to em-dash (em-dash beats leaking a hash slice).
import { ROAD_RUN_STATE_TONE } from '@fleet/domain';
import { loadDispatchBoard } from './load-board';
import { loadReferences } from './load-references';
import { buildLookup, formatOperator, formatOrderRef, formatVehicle } from './labels';
import { LogoutButton } from '../auth/LogoutButton';
import type { DispatchBoardRoadRun } from './types';
const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
function formatPlannedStart(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : PLANNED_FORMATTER.format(d);
}
function StateBadge({ state }: { state: DispatchBoardRoadRun['state'] }): React.ReactElement {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${ROAD_RUN_STATE_TONE[state]}`}>
      {state}
    </span>
  );
}
export async function DispatchBoard(): Promise<React.ReactElement> {
  const [runs, refs] = await Promise.all([loadDispatchBoard(), loadReferences()]);
  const driverLookup = buildLookup(refs.drivers);
  const vehicleLookup = buildLookup(refs.vehicles);
  return (
    <section className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lệnh điều xe</h1>
        <LogoutButton />
      </header>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-2">Số lệnh</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Tài xế</th>
            <th className="px-3 py-2">Xe</th>
            <th className="px-3 py-2">Ngày dự kiến</th>
            <th className="px-3 py-2">Số điểm</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.roadRunId} className="border-b">
              <td className="px-3 py-2 font-mono">{formatOrderRef(r.transportOrderRefs)}</td>
              <td className="px-3 py-2"><StateBadge state={r.state} /></td>
              <td className="px-3 py-2">{formatOperator(r.assignedOperatorId, driverLookup)}</td>
              <td className="px-3 py-2">{formatVehicle(r.assignedAssetId, vehicleLookup)}</td>
              <td className="px-3 py-2">{formatPlannedStart(r.plannedStartAt)}</td>
              <td className="px-3 py-2">{r.stopCount}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Chưa có lệnh điều xe nào.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// apps/ops-web/src/features/dispatch/DispatchBoard.tsx
import { ROAD_RUN_STATE_TONE } from '@fleet/domain';
import { loadDispatchBoard } from './load-board.js';
import type { DispatchBoardRoadRun } from './types.js';

function StateBadge({ state }: { state: DispatchBoardRoadRun['state'] }): React.ReactElement {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${ROAD_RUN_STATE_TONE[state]}`}>
      {state}
    </span>
  );
}

export async function DispatchBoard(): Promise<React.ReactElement> {
  const runs = await loadDispatchBoard();
  return (
    <section className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Dispatch board</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-2">Road run</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2">Operator</th>
            <th className="px-3 py-2">Asset</th>
            <th className="px-3 py-2">Planned</th>
            <th className="px-3 py-2">Stops</th>
            <th className="px-3 py-2">Orders</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.roadRunId} className="border-b">
              <td className="px-3 py-2 font-mono text-xs">{r.roadRunId.slice(0, 8)}</td>
              <td className="px-3 py-2"><StateBadge state={r.state} /></td>
              <td className="px-3 py-2">{r.assignedOperatorId ?? '—'}</td>
              <td className="px-3 py-2">{r.assignedAssetId ?? '—'}</td>
              <td className="px-3 py-2">{r.plannedStartAt ?? '—'}</td>
              <td className="px-3 py-2">{r.stopCount}</td>
              <td className="px-3 py-2">{r.transportOrderRefs.join(', ')}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No road runs.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

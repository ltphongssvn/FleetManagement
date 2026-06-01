// apps/ops-web/src/features/dispatch/DispatchView.tsx
// T3 (2026-Q2) optimistic UI wrapper. Owns BOTH the CreateOrderForm and
// the DispatchBoard table on the dispatcher home page.
//
// T6 (2026): the dispatch board row uses a plain <a> with NO JS handler.
// Under the parent re-render cascade, the App Router <Link> (and router.push
// from an onClick) falls into a stuck-prefetch loop (vercel/next.js#57565):
// clicks emit RSC fetches that return 200 but the router never commits the
// navigation, retrying until ERR_INSUFFICIENT_RESOURCES. The 2026 escape hatch
// is native browser navigation: a plain anchor with href triggers a full-page
// load that bypasses Next.js's RSC state machine entirely.
//
// RE-RENDER LOOP FIX (2026): the board previously ran a useOptimistic hook IN
// PARALLEL with a stickyRuns useState. After create, router.refresh() produced
// a fresh initialRuns reference each cycle; the useOptimistic value was
// re-derived on every render and, combined with the auto-prefetching <a> rows
// re-mounting, drove an unbounded RSC re-render storm (?_rsc= ->
// ERR_INSUFFICIENT_RESOURCES; server [loadReferences] repeating endlessly;
// blinking board). The optimistic row is fully served by stickyRuns (plain
// useState), which converges: it is appended once on create and pruned once
// the real projection row arrives. Removing the redundant useOptimistic stops
// the loop while preserving immediate-visibility. (react.dev: effects must
// reach a fixed point; nextjs.org prefetching: avoid churn on dynamic lists.)
'use client';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { ROAD_RUN_STATE_TONE } from '@fleet/domain';
import { CreateOrderForm, type CreateOrderFormProps } from './CreateOrderForm';
import { LogoutButton } from '../auth/LogoutButton';
import { ExportOrdersExcelButton } from './ExportOrdersExcelButton';
import { buildLookup, formatOperator, formatOrderRef, formatVehicle } from './labels';
import type { DispatchBoardRoadRun } from './types';
import { StopSlotHeaders, StopSlotCells, STOP_SLOT_COL_COUNT } from './board-stops';
const PLANNED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
function formatPlannedStart(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : PLANNED_FORMATTER.format(d);
}
function StateBadge({ state }: { state: DispatchBoardRoadRun['state'] }): JSX.Element {
  return (
    <span className={'inline-block rounded px-2 py-0.5 text-xs font-medium ' + ROAD_RUN_STATE_TONE[state]}>{state}</span>
  );
}
function OrderRefCell({ refs }: { refs: readonly string[] }): JSX.Element {
  const primary = refs[0];
  if (primary === undefined) {
    return <span className='font-mono'>{formatOrderRef(refs)}</span>;
  }
  const href = '/dispatch/orders/' + primary;
  const testId = 'dispatch-board-row-' + primary;
  return (
    <a href={href} data-testid={testId} className='font-mono text-blue-700 underline-offset-2 hover:underline cursor-pointer'>{formatOrderRef(refs)}</a>
  );
}
export interface DispatchViewProps {
  readonly initialRuns: readonly DispatchBoardRoadRun[];
  readonly refs: Omit<CreateOrderFormProps, 'locale'> & { readonly nextOrderRef?: string };
  readonly onMountForTest?: (push: (externalRef: string, op: { operatorId: string; assetId: string }) => void) => void;
}
function makeOptimisticRow(externalRef: string, opCtx: { operatorId: string; assetId: string }): DispatchBoardRoadRun {
  return {
    roadRunId: 'optimistic-' + externalRef,
    state: 'planned',
    assignedOperatorId: opCtx.operatorId,
    assignedAssetId: opCtx.assetId,
    plannedStartAt: null,
    stopCount: 1,
    transportOrderRefs: [externalRef],
    stops: [],
  };
}
function mergeRuns(serverRuns: readonly DispatchBoardRoadRun[], optimistic: readonly DispatchBoardRoadRun[]): readonly DispatchBoardRoadRun[] {
  if (optimistic.length === 0) return serverRuns;
  // Reconcile optimistic list items by a STABLE unique id (roadRunId), never by
  // a mutable business value. Optimistic rows use synthetic 'optimistic-<ref>'
  // ids that never collide with a real UUID, so a stale projection row sharing
  // the same external_ref cannot hide the fresh optimistic row.
  const serverRoadRunIds = new Set<string>();
  for (const r of serverRuns) serverRoadRunIds.add(r.roadRunId);
  const additions = optimistic.filter((r) => !serverRoadRunIds.has(r.roadRunId));
  return additions.length === 0 ? serverRuns : [...additions, ...serverRuns];
}
export function DispatchView(props: DispatchViewProps): JSX.Element {
  const { initialRuns, refs, onMountForTest } = props;
  const router = useRouter();
  // Single source of optimistic rows: plain useState. Unlike useOptimistic,
  // this does NOT re-derive on every render, so it cannot drive a re-render
  // loop when router.refresh() supplies a fresh initialRuns reference.
  const [stickyRuns, setStickyRuns] = useState<readonly DispatchBoardRoadRun[]>([]);
  const pushOptimisticRow = (externalRef: string, op: { operatorId: string; assetId: string }): void => {
    setStickyRuns((prev) => {
      for (const r of prev) {
        if (r.roadRunId === 'optimistic-' + externalRef) return prev;
      }
      return [...prev, makeOptimisticRow(externalRef, op)];
    });
  };
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (onMountForTest) onMountForTest(pushOptimisticRow);
  }, [onMountForTest]);
  useEffect(() => {
    if (stickyRuns.length === 0) return;
    // Prune an optimistic row once the REAL projection row for the same ref
    // arrives from the server. Keyed on external_ref because the server row's
    // roadRunId is a real UUID, distinct from the synthetic 'optimistic-<ref>';
    // the ref is what links the two. The length guard ensures we never re-set
    // identical state, so the effect reaches a fixed point (no loop).
    const serverRefs = new Set<string>();
    for (const r of initialRuns) {
      for (const ref of r.transportOrderRefs) serverRefs.add(ref);
    }
    const next = stickyRuns.filter((r) => {
      for (const ref of r.transportOrderRefs) if (serverRefs.has(ref)) return false;
      return true;
    });
    if (next.length !== stickyRuns.length) setStickyRuns(next);
  }, [initialRuns, stickyRuns]);
  const driverLookup = buildLookup(refs.drivers);
  const vehicleLookup = buildLookup(refs.vehicles ?? []);
  const merged = mergeRuns(initialRuns, stickyRuns);
  const handleCreated = (externalRef: string, op: { operatorId: string; assetId: string }): void => {
    if (op.operatorId !== '' && op.assetId !== '') {
      pushOptimisticRow(externalRef, op);
    }
    router.refresh();
  };
  return (
    <>
      <CreateOrderForm
        drivers={refs.drivers}
        vehicles={refs.vehicles ?? []}
        customers={refs.customers ?? []}
        cargoTypes={refs.cargoTypes ?? []}
        pickupWarehouses={refs.pickupWarehouses ?? []}
        deliveryWarehouses={refs.deliveryWarehouses ?? []}
        driverVehicleAssignments={refs.driverVehicleAssignments ?? []}
        defaultOrderRef={refs.nextOrderRef ?? ''}
        onCreated={handleCreated}
      />
      <div className='mt-8 rounded-2xl bg-white/95 shadow-sm'>
        <section className='p-6'>
          <header className='mb-4 flex items-center justify-between'>
            <h1 className='text-2xl font-semibold'>Lệnh điều xe</h1>
            <div className='flex items-center gap-2'><ExportOrdersExcelButton /><LogoutButton /></div>
          </header>
          <table className='w-full border-collapse text-sm'>
            <thead>
              <tr className='border-b text-left'>
                <th className='px-3 py-2'>Số lệnh</th>
                <th className='px-3 py-2'>Trạng thái</th>
                <th className='px-3 py-2'>Tài xế</th>
                <th className='px-3 py-2'>Xe</th>
                <th className='px-3 py-2'>Ngày dự kiến</th>
                <th className='px-3 py-2'>Số điểm</th>
                <StopSlotHeaders />
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => (
                <tr key={r.roadRunId} data-testid={'dispatch-board-rr-' + r.roadRunId} className='border-b'>
                  <td className='px-3 py-2'><OrderRefCell refs={r.transportOrderRefs} /></td>
                  <td className='px-3 py-2'><StateBadge state={r.state} /></td>
                  <td className='px-3 py-2'>{formatOperator(r.assignedOperatorId, driverLookup)}</td>
                  <td className='px-3 py-2'>{formatVehicle(r.assignedAssetId, vehicleLookup)}</td>
                  <td className='px-3 py-2'>{formatPlannedStart(r.plannedStartAt)}</td>
                  <td className='px-3 py-2'>{r.stopCount}</td>
                  <StopSlotCells primaryRef={formatOrderRef(r.transportOrderRefs)} stops={r.stops} />
                </tr>
              ))}
              {merged.length === 0 && (
                <tr><td colSpan={6 + STOP_SLOT_COL_COUNT} className='px-3 py-6 text-center text-slate-500'>Chưa có lệnh điều xe nào.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

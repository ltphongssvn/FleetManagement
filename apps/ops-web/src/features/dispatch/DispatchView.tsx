// apps/ops-web/src/features/dispatch/DispatchView.tsx
// T3 (2026-Q2) optimistic UI wrapper. Owns BOTH the CreateOrderForm and
// the DispatchBoard table on the dispatcher home page.
//
// T6 (2026): the dispatch board row uses a plain <a> with NO JS handler.
// Under useOptimistic + the parent re-render cascade, the App Router
// <Link> (and router.push from an onClick) falls into a stuck-prefetch
// loop (vercel/next.js#57565, heroui-inc/heroui#2289): clicks emit RSC
// fetches that return 200 but the router never commits the navigation,
// instead retrying until ERR_INSUFFICIENT_RESOURCES. The 2026 industry
// escape hatch is native browser navigation: a plain anchor with href
// triggers a full-page load that bypasses Next.js's RSC state machine
// entirely. The cost is a single hard reload on row click; the benefit
// is reliable first-click navigation to the review view.
'use client';
import { useEffect, useOptimistic, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { ROAD_RUN_STATE_TONE } from '@fleet/domain';
import { CreateOrderForm, type CreateOrderFormProps } from './CreateOrderForm';
import { LogoutButton } from '../auth/LogoutButton';
import { ExportOrdersExcelButton } from './ExportOrdersExcelButton';
import { buildLookup, formatOperator, formatOrderRef, formatVehicle } from './labels';
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
  };
}
function mergeRuns(serverRuns: readonly DispatchBoardRoadRun[], optimistic: readonly DispatchBoardRoadRun[]): readonly DispatchBoardRoadRun[] {
  if (optimistic.length === 0) return serverRuns;
  const serverRefs = new Set<string>();
  for (const r of serverRuns) {
    for (const ref of r.transportOrderRefs) serverRefs.add(ref);
  }
  const additions = optimistic.filter((r) => {
    for (const ref of r.transportOrderRefs) if (serverRefs.has(ref)) return false;
    return true;
  });
  return additions.length === 0 ? serverRuns : [...additions, ...serverRuns];
}
export function DispatchView(props: DispatchViewProps): JSX.Element {
  const { initialRuns, refs, onMountForTest } = props;
  const router = useRouter();
  interface OptimisticAction { externalRef: string; op: { operatorId: string; assetId: string } }
  const [optimisticRuns] = useOptimistic([] as readonly DispatchBoardRoadRun[], (current: readonly DispatchBoardRoadRun[], action: OptimisticAction) => [...current, makeOptimisticRow(action.externalRef, action.op)]);
  const [stickyRuns, setStickyRuns] = useState<readonly DispatchBoardRoadRun[]>([]);
  const pushOptimisticRow = (externalRef: string, op: { operatorId: string; assetId: string }): void => {
    setStickyRuns((prev) => {
      for (const r of prev) {
        for (const ref of r.transportOrderRefs) if (ref === externalRef) return prev;
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
  const merged = mergeRuns(initialRuns, [...optimisticRuns, ...stickyRuns]);
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
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => (
                <tr key={r.roadRunId} className='border-b'>
                  <td className='px-3 py-2'><OrderRefCell refs={r.transportOrderRefs} /></td>
                  <td className='px-3 py-2'><StateBadge state={r.state} /></td>
                  <td className='px-3 py-2'>{formatOperator(r.assignedOperatorId, driverLookup)}</td>
                  <td className='px-3 py-2'>{formatVehicle(r.assignedAssetId, vehicleLookup)}</td>
                  <td className='px-3 py-2'>{formatPlannedStart(r.plannedStartAt)}</td>
                  <td className='px-3 py-2'>{r.stopCount}</td>
                </tr>
              ))}
              {merged.length === 0 && (
                <tr><td colSpan={6} className='px-3 py-6 text-center text-slate-500'>Chưa có lệnh điều xe nào.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

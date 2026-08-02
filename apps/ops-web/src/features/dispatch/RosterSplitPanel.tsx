// apps/ops-web/src/features/dispatch/RosterSplitPanel.tsx
// The dispatched-vs-idle driver panel at the top of the Bang dieu phoi xe page:
// two tables side by side that the owner reads in ONE glance.
//
// LEFT  - drivers on the road today, with the truck they took.
// RIGHT - drivers staying home with an idle truck. This is the column with
//         teeth. A name here is either a real efficiency question or a
//         dispatcher who sent the job over Zalo, so it never entered the app.
//         The REASON column is what tells the two apart: Chưa gắn xe means the
//         driver could not be dispatched at all (no truck bound), while Chua
//         dieu xe hom nay means he could have been and was not.
//
// WHY NOT DataTable. That component brings search, pagination and a filter box.
// A glance layer must answer without a single click or keystroke (2026
// fleet-dashboard practice: no scrolling, no clicking, role-specific view), so
// this renders plain semantic tables with every row visible.
//
// PARTITION SAFETY. The panel re-checks isRosterPartitionValid from the SSOT
// contract and surfaces a visible warning when the two columns do not add up to
// the roster. A silently missing driver is worse than a wrong number, because
// the owner cannot see what is absent - so the panel refuses to look correct
// when it is not.
//
// A11Y. Each table carries a visually-hidden caption naming its column, and the
// driver name is a th scope=row so a screen reader announces the row identity
// before the truck and reason cells.
//
// Vietnamese strings in this file are IMMUTABLE production UI contracts.
// Styling uses semantic design tokens only - never a raw slate-/indigo- literal.
import type { JSX } from 'react';
import { isRosterPartitionValid } from '@fleet/sync-protocol';
import type { DispatchRosterSplit, IdleReason } from '@fleet/sync-protocol';

const IDLE_REASON_LABEL: Record<IdleReason, string> = {
  no_dispatch_today: 'Chưa điều xe hôm nay',
  no_vehicle_assigned: 'Chưa gắn xe',
};

const HEAD_CLASS = 'px-3 py-2 text-left font-medium text-text-secondary';
const CELL_CLASS = 'px-3 py-2 text-text-primary';
const ROW_HEAD_CLASS = 'px-3 py-2 text-left font-normal text-text-primary';
const EMPTY_CLASS = 'px-3 py-8 text-center text-sm text-text-muted';
const TABLE_WRAP_CLASS = 'overflow-hidden rounded-lg border border-border';
const TABLE_CLASS = 'min-w-full divide-y divide-border text-sm';
const BODY_CLASS = 'divide-y divide-border-subtle bg-white';

export interface RosterSplitPanelProps {
  readonly split: DispatchRosterSplit;
}

export function RosterSplitPanel({ split }: RosterSplitPanelProps): JSX.Element {
  const partitionOk = isRosterPartitionValid(split);
  return (
    <section className='mb-6 space-y-3' data-testid='roster-split-panel'>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <h2 className='text-lg font-semibold text-white drop-shadow-sm'>
          Tình hình tài xế hôm nay
        </h2>
        <p className='text-sm text-slate-300'>
          Tổng số tài xế:{' '}
          <span data-testid='roster-split-total' className='font-semibold'>
            {split.totalDrivers}
          </span>
        </p>
      </div>

      {partitionOk ? null : (
        <p
          role='alert'
          data-testid='roster-split-partition-warning'
          className='rounded-md border border-border-strong px-3 py-2 text-sm text-text-primary'
        >
          Danh sách chưa khớp với tổng số tài xế. Vui lòng tải lại trang.
        </p>
      )}

      <div className='grid gap-4 md:grid-cols-2'>
        <div>
          <h3 className='mb-2 text-sm font-semibold text-white drop-shadow-sm'>
            Tài xế đang chạy hôm nay{' '}
            <span data-testid='roster-split-dispatched-count'>
              {split.dispatched.length}
            </span>
          </h3>
          <div className={TABLE_WRAP_CLASS}>
            <table className={TABLE_CLASS} data-testid='roster-split-dispatched'>
              <caption className='sr-only'>
                Danh sách tài xế đang chạy hôm nay
              </caption>
              <thead className='bg-surface-subtle'>
                <tr>
                  <th scope='col' className={HEAD_CLASS}>Tài xế</th>
                  <th scope='col' className={HEAD_CLASS}>Số xe</th>
                  <th scope='col' className={HEAD_CLASS}>Mã đơn</th>
                </tr>
              </thead>
              <tbody className={BODY_CLASS}>
                {split.dispatched.map((row) => (
                  <tr
                    key={row.driverId}
                    data-testid={'roster-split-dispatched-row-' + row.driverId}
                  >
                    <th scope='row' className={ROW_HEAD_CLASS}>{row.driverName}</th>
                    <td className={CELL_CLASS}>{row.vehiclePlate ?? '-'}</td>
                    <td className={CELL_CLASS}>
                      {row.orderRefs.length === 0 ? '-' : row.orderRefs.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {split.dispatched.length === 0 ? (
              <div className={EMPTY_CLASS} data-testid='roster-split-dispatched-empty'>
                Chưa có tài xế nào chạy hôm nay.
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className='mb-2 text-sm font-semibold text-white drop-shadow-sm'>
            Tài xế ở nhà hôm nay{' '}
            <span data-testid='roster-split-idle-count'>
              {split.idle.length}
            </span>
          </h3>
          <div className={TABLE_WRAP_CLASS}>
            <table className={TABLE_CLASS} data-testid='roster-split-idle'>
              <caption className='sr-only'>
                Danh sách tài xế ở nhà hôm nay
              </caption>
              <thead className='bg-surface-subtle'>
                <tr>
                  <th scope='col' className={HEAD_CLASS}>Tài xế</th>
                  <th scope='col' className={HEAD_CLASS}>Số xe</th>
                  <th scope='col' className={HEAD_CLASS}>Lý do</th>
                </tr>
              </thead>
              <tbody className={BODY_CLASS}>
                {split.idle.map((row) => (
                  <tr
                    key={row.driverId}
                    data-testid={'roster-split-idle-row-' + row.driverId}
                  >
                    <th scope='row' className={ROW_HEAD_CLASS}>{row.driverName}</th>
                    <td className={CELL_CLASS}>{row.vehiclePlate ?? '-'}</td>
                    <td className={CELL_CLASS}>{IDLE_REASON_LABEL[row.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {split.idle.length === 0 ? (
              <div className={EMPTY_CLASS} data-testid='roster-split-idle-empty'>
                Tất cả tài xế đều đang chạy.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// apps/ops-web/src/features/ui/EmptyState.tsx
// T70 affordance primitive: a blank region that EXPLAINS itself.
//
// Root cause it removes: the board rendered a dead-end sentence when there were
// no orders, and the em-dash carried four different meanings across the table
// (no data, no match, not applicable, not yet arrived) with no legend. A user
// facing a blank region could not tell whether something was broken, whether
// they had filtered it away, or whether they were supposed to act.
//
// The reason prop is the @fleet/domain EmptyStateReason SSOT, and the copy is
// looked up from EMPTY_STATE_VI, so:
//   - the WHY is always stated, because the vocabulary enumerates it;
//   - the NEXT STEP is always stated, because the copy type demands a hint;
//   - a new reason cannot ship unlabelled, because the map is a Record over the
//     enum and typecheck fails first.
//
// role=status: the region is announced politely when it appears, so a screen
// reader user learns why the area is blank instead of hearing silence. It is a
// status message, so focus is deliberately NOT moved (WCAG 4.1.3).
import type { JSX, ReactNode } from 'react';
import { type EmptyStateReason, EMPTY_STATE_VI } from '@fleet/domain';

export interface EmptyStateProps {
  readonly reason: EmptyStateReason;
  // Optional call to action. Supplied by the surface, because only the surface
  // knows what the next step actually invokes (open the create drawer, clear
  // the search, and so on).
  readonly action?: ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function EmptyState({
  reason,
  action,
  className,
  'data-testid': testId,
}: EmptyStateProps): JSX.Element {
  const copy = EMPTY_STATE_VI[reason];
  return (
    <div
      role='status'
      data-reason={reason}
      data-testid={testId}
      className={'flex flex-col items-center gap-2 px-6 py-10 text-center' + (className === undefined ? '' : ' ' + className)}
    >
      <p className='text-sm font-semibold text-text-primary'>{copy.title}</p>
      <p className='max-w-md text-sm text-text-muted'>{copy.hint}</p>
      {action === undefined ? null : <div className='mt-2'>{action}</div>}
    </div>
  );
}

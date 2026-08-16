// apps/ops-web/src/features/ui/HelpHint.tsx
// T70 affordance primitive: the per-surface help mechanism.
//
// Root cause it removes: a git grep across apps/ops-web/src for Tooltip /
// onboard / aria-describedby returned ONE hit before this arc. The product had
// no help affordance at all, so a user who did not already know the workflow
// had nowhere to look. WCAG 3.2.6 Consistent Help (Level A) requires that where
// a help mechanism exists it sits in the SAME relative position on every page
// that has one -- which is enforceable only because HELP_TOPICS enumerates the
// places, and only because every surface mounts this same component.
//
// Progressive disclosure, not permanent chrome: a dispatcher works a dense
// board all day and must not pay for guidance they no longer need. The trigger
// is always visible; the steps are revealed on demand and collapse again.
//
// Steps, not prose: the complaint is not knowing what to DO. HELP_TOPIC_VI
// supplies an ordered list, rendered as a real OL so the sequence is conveyed
// structurally to assistive technology rather than by visual numbering alone.
'use client';
import { useId, useState } from 'react';
import type { JSX } from 'react';
import { type HelpTopic, HELP_TOPIC_VI } from '@fleet/domain';
import { Button } from './Button';

// The accessible name of the trigger. One constant, so every surface exposes
// the identical control and the 3.2.6 consistency claim is literal.
export const HELP_TRIGGER_LABEL = 'Hướng dẫn';

export interface HelpHintProps {
  readonly topic: HelpTopic;
  readonly className?: string;
}

export function HelpHint({ topic, className }: HelpHintProps): JSX.Element {
  const [open, setOpen] = useState(false);
  // useId gives a stable id across server and client render, so aria-controls
  // points at a real node without a hand-rolled counter that could collide when
  // two surfaces mount a HelpHint on the same page.
  const panelId = useId();
  const copy = HELP_TOPIC_VI[topic];
  return (
    <div className={className === undefined ? 'relative' : 'relative ' + className}>
      <Button
        tone='neutral'
        emphasis='ghost'
        onClick={() => { setOpen((v) => !v); }}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={panelId}
        data-testid={'help-trigger-' + topic}
      >
        <span aria-hidden='true'>?</span>
        {HELP_TRIGGER_LABEL}
      </Button>
      {open ? (
        <div
          id={panelId}
          data-testid={'help-panel-' + topic}
          className='absolute right-0 z-30 mt-2 w-80 rounded-lg border border-border bg-white p-4 text-left shadow-lg'
        >
          <p className='mb-2 text-sm font-semibold text-text-primary'>{copy.title}</p>
          <ol className='list-decimal space-y-1 pl-5 text-sm text-text-secondary'>
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

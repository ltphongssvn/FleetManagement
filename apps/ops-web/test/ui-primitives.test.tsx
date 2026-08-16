// apps/ops-web/test/ui-primitives.test.tsx
// RED-first contract test for the T70 ops-web AFFORDANCE PRIMITIVES.
//
// Why primitives and not per-screen fixes: the board, the create drawer, the
// order detail and the database admin page each hand-roll their own interactive
// markup, so a control is only as discoverable as the author remembered to make
// it. These five primitives are the ONLY sanctioned way to author an
// interactive element in ops-web from here on; the affordance rules below are
// therefore asserted once, on the primitive, instead of being re-reviewed on
// every screen.
//
// Every rule below is bound to the @fleet/domain SSOT rather than a local
// literal, so a vocabulary change fails HERE instead of drifting silently:
//   - MIN_TARGET_SIZE_PX (WCAG 2.2 SC 2.5.8, AA) is the hit-area floor.
//   - ActionTone / ActionEmphasis drive appearance; a raw colour prop does not
//     exist, so WCAG 1.4.1 cannot be violated by a caller.
//   - EMPTY_STATE_VI / HELP_TOPIC_VI supply the copy, so an empty region always
//     states why it is empty and what to do next, and help is always steps.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ACTION_TONES,
  ACTION_EMPHASES,
  EMPTY_STATE_REASONS,
  EMPTY_STATE_VI,
  HELP_TOPICS,
  HELP_TOPIC_VI,
  MIN_TARGET_SIZE_PX,
} from '@fleet/domain';
import { Button } from '../src/features/ui/Button';
import { IconButton } from '../src/features/ui/IconButton';
import { EmptyState } from '../src/features/ui/EmptyState';
import { HelpHint } from '../src/features/ui/HelpHint';
import { FieldLabel } from '../src/features/ui/FieldLabel';

const px = (n: number): string => String(n) + 'px';

describe('Button', () => {
  it('renders a real button element with the accessible name from its children', () => {
    // Pattern affordance: a button must BE a button. The board previously used
    // bare anchors and text spans for actions, which is why users could not tell
    // what was clickable.
    render(<Button tone='primary' emphasis='solid'>Tạo lệnh điều xe</Button>);
    const btn = screen.getByRole('button', { name: 'Tạo lệnh điều xe' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('meets the WCAG 2.5.8 target-size floor for every tone and emphasis', () => {
    // Asserted across the FULL cross product so a future tone or emphasis cannot
    // be added with a smaller hit area than the contract allows.
    for (const tone of ACTION_TONES) {
      for (const emphasis of ACTION_EMPHASES) {
        const testId = 'btn-' + tone + '-' + emphasis;
        render(
          <Button tone={tone} emphasis={emphasis} data-testid={testId}>
            Thao tác
          </Button>,
        );
        const btn = screen.getByTestId(testId);
        expect(btn.style.minHeight).toBe(px(MIN_TARGET_SIZE_PX));
        expect(btn.style.minWidth).toBe(px(MIN_TARGET_SIZE_PX));
      }
    }
  });

  it('exposes tone and emphasis as data attributes rather than a colour prop', () => {
    // WCAG 1.4.1: meaning travels as a NAMED role. A caller cannot pass a colour,
    // and a test or an e2e spec can assert intent without matching class strings.
    render(<Button tone='danger' emphasis='solid' data-testid='btn-delete'>Xóa</Button>);
    const btn = screen.getByTestId('btn-delete');
    expect(btn.getAttribute('data-tone')).toBe('danger');
    expect(btn.getAttribute('data-emphasis')).toBe('solid');
  });

  it('carries a visible focus ring class so keyboard focus is never invisible', () => {
    render(<Button tone='neutral' emphasis='ghost' data-testid='btn-focus'>Đóng</Button>);
    expect(screen.getByTestId('btn-focus').className).toContain('focus-visible:ring');
  });

  it('marks a disabled button as disabled to assistive technology, not just visually', () => {
    render(<Button tone='primary' emphasis='solid' disabled data-testid='btn-disabled'>Lưu</Button>);
    const btn = screen.getByTestId('btn-disabled');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('invokes onClick when activated', async () => {
    let clicks = 0;
    render(
      <Button tone='primary' emphasis='solid' onClick={() => { clicks += 1; }}>
        Tạo lệnh
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tạo lệnh' }));
    expect(clicks).toBe(1);
  });
});

describe('IconButton', () => {
  it('requires a text label and exposes it as the accessible name', () => {
    // An icon with no name is the purest form of the reported complaint: the
    // control exists but nothing says what it does.
    render(
      <IconButton tone='neutral' emphasis='ghost' label='Trợ giúp' data-testid='icon-help'>
        <svg aria-hidden='true' />
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'Trợ giúp' });
    expect(btn.getAttribute('aria-label')).toBe('Trợ giúp');
  });

  it('uses the 44px comfortable touch target, above the 24px minimum', () => {
    // Icon-only controls carry no text to enlarge the hit area, so they take the
    // WCAG AAA-recommended 44px rather than the bare AA floor.
    render(
      <IconButton tone='neutral' emphasis='ghost' label='Đóng' data-testid='icon-close'>
        <svg aria-hidden='true' />
      </IconButton>,
    );
    const btn = screen.getByTestId('icon-close');
    expect(btn.style.minHeight).toBe(px(44));
    expect(btn.style.minWidth).toBe(px(44));
    expect(44).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX);
  });
});

describe('EmptyState', () => {
  it('renders the SSOT Vietnamese title and next-step hint for every reason', () => {
    for (const reason of EMPTY_STATE_REASONS) {
      const { unmount } = render(<EmptyState reason={reason} />);
      expect(screen.getByText(EMPTY_STATE_VI[reason].title)).toBeInTheDocument();
      expect(screen.getByText(EMPTY_STATE_VI[reason].hint)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders an optional call-to-action next to the hint', () => {
    // UX-06: the empty board previously ended the user journey with a sentence.
    render(
      <EmptyState
        reason='no_data_yet'
        action={<Button tone='primary' emphasis='solid'>Tạo lệnh điều xe</Button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Tạo lệnh điều xe' })).toBeInTheDocument();
  });

  it('is announced as a status region so a screen reader learns why the area is blank', () => {
    render(<EmptyState reason='no_search_results' data-testid='empty-search' />);
    expect(screen.getByTestId('empty-search').getAttribute('role')).toBe('status');
  });
});

describe('HelpHint', () => {
  it('offers a named help control for every topic', () => {
    for (const topic of HELP_TOPICS) {
      const { unmount } = render(<HelpHint topic={topic} />);
      expect(screen.getByRole('button', { name: 'Hướng dẫn' })).toBeInTheDocument();
      unmount();
    }
  });

  it('keeps the guidance collapsed until asked, then reveals the SSOT steps', async () => {
    // Progressive disclosure: guidance must be available without permanently
    // consuming the density a dispatcher relies on.
    render(<HelpHint topic='dispatch_board' />);
    const trigger = screen.getByRole('button', { name: 'Hướng dẫn' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(HELP_TOPIC_VI.dispatch_board.title)).toBeNull();

    await userEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(HELP_TOPIC_VI.dispatch_board.title)).toBeInTheDocument();
    for (const step of HELP_TOPIC_VI.dispatch_board.steps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('renders the steps as an ordered list so the sequence is conveyed structurally', async () => {
    render(<HelpHint topic='create_order' />);
    await userEvent.click(screen.getByRole('button', { name: 'Hướng dẫn' }));
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(screen.getAllByRole('listitem')).toHaveLength(HELP_TOPIC_VI.create_order.steps.length);
  });

  it('links the trigger to the panel it controls', async () => {
    render(<HelpHint topic='order_detail' />);
    const trigger = screen.getByRole('button', { name: 'Hướng dẫn' });
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).not.toBeNull();
    await userEvent.click(trigger);
    expect(document.getElementById(String(controls))).not.toBeNull();
  });
});

describe('FieldLabel', () => {
  it('renders a persistent visible label bound to its control', () => {
    // WCAG 3.3.2: placeholder text alone is not a label, because it disappears
    // on the first keystroke. Every combobox in the create drawer was
    // placeholder-only (defect UX-12).
    render(
      <div>
        <FieldLabel htmlFor='vehiclePlate'>Số xe</FieldLabel>
        <input id='vehiclePlate' />
      </div>,
    );
    const input = screen.getByLabelText('Số xe');
    expect(input.getAttribute('id')).toBe('vehiclePlate');
  });

  it('marks a required field in text, not by colour or an unexplained asterisk', () => {
    render(
      <div>
        <FieldLabel htmlFor='driver' required>Tài xế</FieldLabel>
        <input id='driver' />
      </div>,
    );
    expect(screen.getByText('bắt buộc')).toBeInTheDocument();
  });

  it('renders an optional hint tied to the control via aria-describedby', () => {
    render(
      <div>
        <FieldLabel htmlFor='pickupAt' hint='Ngày tài xế tới kho lấy hàng.' />
        <input id='pickupAt' aria-describedby='pickupAt-hint' />
      </div>,
    );
    const hint = screen.getByText('Ngày tài xế tới kho lấy hàng.');
    expect(hint.getAttribute('id')).toBe('pickupAt-hint');
  });
});

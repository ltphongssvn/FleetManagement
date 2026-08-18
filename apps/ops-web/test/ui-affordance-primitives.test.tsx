// apps/ops-web/test/ui-affordance-primitives.test.tsx
// Branch coverage for the five T70 affordance primitives.
//
// WHY THIS EXISTS. The primitives shipped exercised only INDIRECTLY, through
// dispatch-view-affordance.test.tsx, which renders each one exactly one way.
// Statement coverage therefore read 100% while branch coverage sat at 66-83%,
// and the pre-push gate refused the push: every optional-prop ternary had a
// side that no test had ever taken.
//
// That gap is not cosmetic for THESE components specifically. Each ternary is
// an affordance decision -- whether a control announces itself as disabled,
// whether a required field is marked, whether an empty region offers a next
// step. An untaken branch here is a user-visible affordance that has never
// once been rendered in a test.
//
// So each case below drives a real branch pair, not a coverage number:
//   className supplied vs omitted   (all five)
//   type defaulted vs explicit      (Button, IconButton)
//   disabled true vs absent         (Button, IconButton)
//   required true vs absent         (FieldLabel)
//   hint supplied vs omitted        (FieldLabel)
//   action supplied vs omitted      (EmptyState)
//   help panel open vs closed       (HelpHint)
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/features/ui/Button';
import { IconButton, ICON_BUTTON_SIZE_PX } from '@/features/ui/IconButton';
import { EmptyState } from '@/features/ui/EmptyState';
import { FieldLabel, REQUIRED_MARKER_VI } from '@/features/ui/FieldLabel';
import { HelpHint, HELP_TRIGGER_LABEL } from '@/features/ui/HelpHint';

describe('Button - variant branches', () => {
  it('defaults type to button and is not disabled', () => {
    render(<Button tone='primary' emphasis='solid'>Tạo lệnh</Button>);
    const btn = screen.getByRole('button', { name: 'Tạo lệnh' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute('aria-disabled');
  });

  it('honours an explicit type and appends a custom className', () => {
    render(<Button tone='primary' emphasis='solid' type='submit' className='w-full'>Lưu</Button>);
    const btn = screen.getByRole('button', { name: 'Lưu' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.className).toContain('w-full');
  });

  it('announces the disabled state to assistive tech, not just visually', () => {
    render(<Button tone='danger' emphasis='solid' disabled>Xóa</Button>);
    const btn = screen.getByRole('button', { name: 'Xóa' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('IconButton - the label is the point', () => {
  it('exposes the label to screen readers AND to hover', () => {
    render(<IconButton tone='neutral' emphasis='ghost' label='Sửa SĐT' />);
    const btn = screen.getByRole('button', { name: 'Sửa SĐT' });
    expect(btn).toHaveAttribute('title', 'Sửa SĐT');
  });

  it('keeps a comfortable touch target', () => {
    render(<IconButton tone='neutral' emphasis='ghost' label='Thao tác' />);
    const btn = screen.getByRole('button', { name: 'Thao tác' });
    expect(btn.style.minHeight).toBe(String(ICON_BUTTON_SIZE_PX) + 'px');
    expect(btn.style.minWidth).toBe(String(ICON_BUTTON_SIZE_PX) + 'px');
  });

  it('merges a custom className and a caller style without dropping the size floor', () => {
    render(
      <IconButton tone='primary' emphasis='soft' label='Xem' className='ml-2' style={{ opacity: 0.5 }} />,
    );
    const btn = screen.getByRole('button', { name: 'Xem' });
    expect(btn.className).toContain('ml-2');
    expect(btn.style.opacity).toBe('0.5');
    expect(btn.style.minHeight).toBe(String(ICON_BUTTON_SIZE_PX) + 'px');
  });

  it('announces disabled', () => {
    render(<IconButton tone='danger' emphasis='solid' label='Hủy' disabled />);
    const btn = screen.getByRole('button', { name: 'Hủy' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('EmptyState - a blank region that explains itself', () => {
  it('states the reason and the next step, and is announced politely', () => {
    render(<EmptyState reason='no_data_yet' data-testid='empty-no-data' />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('data-reason', 'no_data_yet');
    expect(region.textContent).not.toBe('');
  });

  it('renders a call to action when the surface supplies one', () => {
    render(
      <EmptyState reason='no_search_results' action={<button type='button'>Xóa bộ lọc</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
  });

  it('renders no action wrapper when none is supplied', () => {
    render(<EmptyState reason='no_filter_results' className='mt-4' />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status').className).toContain('mt-4');
  });
});

describe('FieldLabel - required and hint branches', () => {
  it('renders a bare label with no marker and no hint', () => {
    render(<FieldLabel htmlFor='ten-hang'>Tên hàng</FieldLabel>);
    expect(screen.getByText('Tên hàng')).toBeInTheDocument();
    expect(screen.queryByText(REQUIRED_MARKER_VI)).toBeNull();
  });

  it('marks a required field in words, not colour alone', () => {
    render(<FieldLabel htmlFor='so-xe' required className='mb-1'>Số xe</FieldLabel>);
    expect(screen.getByText(REQUIRED_MARKER_VI)).toBeInTheDocument();
  });

  it('renders the hint when supplied', () => {
    render(<FieldLabel htmlFor='sdt' hint='Dùng số nội địa'>SĐT</FieldLabel>);
    expect(screen.getByText('Dùng số nội địa')).toBeInTheDocument();
  });
});

describe('HelpHint - disclosure branches', () => {
  it('starts collapsed', () => {
    render(<HelpHint topic='dispatch_board' />);
    expect(screen.getByRole('button', { name: HELP_TRIGGER_LABEL }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('expands on activation and applies a custom className to the wrapper', async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpHint topic='dispatch_board' className='inline-block' />);
    expect(container.firstElementChild?.className).toContain('inline-block');
    await user.click(screen.getByRole('button', { name: HELP_TRIGGER_LABEL }));
    expect(screen.getByRole('button', { name: HELP_TRIGGER_LABEL }))
      .toHaveAttribute('aria-expanded', 'true');
  });
});

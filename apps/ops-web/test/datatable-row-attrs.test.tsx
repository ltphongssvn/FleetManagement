// apps/ops-web/test/datatable-row-attrs.test.tsx
// RED-first: DataTable needs a GENERIC per-row attribute seam so a caller can
// mark one row (data-testid + className) and request it be scrolled into view.
// This restores the 409-conflict highlight+scroll behavior that was lost when
// the master-data sections migrated from ul/li to the shared table, WITHOUT
// leaking reference-specific semantics into the generic table: TanStack v8 is
// headless and owns no DOM, so row-level DOM concerns belong to the caller.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/features/admin/DataTable';

interface Row { id: string; label: string }

const columns: ColumnDef<Row>[] = [
  { id: 'label', header: 'Ten', accessorFn: (r) => r.label },
];

const data: readonly Row[] = [
  { id: 'r1', label: 'CAM' },
  { id: 'r2', label: 'TAM' },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DataTable per-row attribute seam', () => {
  it('applies testId and className to the matching row only', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        rowAttrs={(r) => (r.id === 'r2' ? { testId: 'row-conflict', className: 'ring-2' } : {})}
      />,
    );
    const marked = screen.getByTestId('row-conflict');
    expect(marked.tagName).toBe('TR');
    expect(marked.textContent).toContain('TAM');
    expect(marked.className).toContain('ring-2');
    expect(screen.queryAllByTestId('row-conflict')).toHaveLength(1);
  });

  it('calls scrollIntoView on the row that requests it', () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });
    render(
      <DataTable
        columns={columns}
        data={data}
        rowAttrs={(r) => (r.id === 'r2' ? { scrollIntoView: true } : {})}
      />,
    );
    expect(scrollSpy).toHaveBeenCalled();
  });
});

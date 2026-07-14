// apps/ops-web/src/app/admin/co-so-du-lieu/page.tsx
// Consolidated Co so du lieu admin page: the single database-style view that
// replaces the separate Doi xe (/admin/drivers) and Du lieu (/admin/reference)
// pages. Phase 1 mounts the DriversSection (drivers + vehicle status via the
// shared DataTable); master-data sections (customers/cargo/vehicles/warehouses)
// layer onto this same page later. Back-link returns to the dispatch board.
// Vietnamese heading + copy are immutable UI contracts.
'use client';
import type { JSX } from 'react';
import { DriversSection } from '@/features/admin/DriversSection';

export default function CoSoDuLieuPage(): JSX.Element {
  return (
    <div className='space-y-6'>
      <div>
        <a
          href='/'
          data-testid='co-so-du-lieu-back'
          className='text-sm text-indigo-300 hover:text-white hover:underline'
        >
          ← Quay lại Bảng điều phối
        </a>
      </div>
      <div>
        <h1 className='text-2xl font-semibold text-white'>Cơ sở dữ liệu</h1>
        <p className='mt-1 text-sm text-slate-300'>
          Danh sách tài xế và trạng thái xe, có tìm kiếm và phân trang.
        </p>
      </div>
      <div className='rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5'>
        <DriversSection />
      </div>
    </div>
  );
}

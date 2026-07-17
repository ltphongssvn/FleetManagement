// apps/ops-web/src/app/admin/co-so-du-lieu/page.tsx
// Consolidated Co so du lieu admin page: the single database-style view that
// replaces the separate Doi xe (/admin/drivers) and Du lieu (/admin/reference)
// pages. Renders the DriversSection (drivers + vehicle status) followed by the
// five shared master-data CRUD sections (Khach hang / Ten hang / So xe / Kho
// nhan hang / Kho giao hang) from the shared reference-sections module -- so
// both this page and the old reference page render the SAME sections without
// duplication. Back-link returns to the dispatch board. VN copy is immutable.
'use client';
import type { JSX } from 'react';
import { DriversSection } from '@/features/admin/DriversSection';
import { SECTIONS, ReferenceSection } from '@/features/admin/reference-sections';

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
          Quản lý tài xế, xe và dữ liệu điều phối.
        </p>
      </div>
      <div className='rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5'>
        <h2 className='mb-3 text-lg font-semibold text-slate-900'>Tài xế &amp; xe</h2>
        <DriversSection />
      </div>
      <div className='rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5'>
        {SECTIONS.map((def) => (
          <ReferenceSection key={def.title} def={def} />
        ))}
      </div>
    </div>
  );
}

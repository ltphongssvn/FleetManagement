// apps/ops-web/src/app/admin/reference/page.tsx
// CRUD admin for dispatch-form master data. The section component + config
// now live in the shared features/admin/reference-sections module so the new
// Co so du lieu page renders the SAME five sections without duplication. This
// page is the original standalone entry; it renders the shared sections under
// the Quan ly du lieu dieu phoi heading, with a link to the drivers admin page.
'use client';
import type { JSX } from 'react';
import { SECTIONS, ReferenceSection } from '@/features/admin/reference-sections';
export default function ReferenceAdminPage(): JSX.Element {
  return (
    <div className='p-6'>
      <div className='mb-4'>
        <a href='/' className='text-sm text-blue-600 hover:underline'>← Quay lại Bảng điều phối</a>
      </div>
      <h1 className='mb-2 text-2xl font-semibold'>Quản lý dữ liệu điều phối</h1>
      <p className='mb-6 text-sm text-gray-600'>
        Thêm, xóa các lựa chọn trong biểu mẫu tạo lệnh.
        {' '}
        <a href='/admin/drivers' className='text-blue-600 hover:underline'>Quản lý tài xế &amp; xe →</a>
      </p>
      {SECTIONS.map((def) => (
        <ReferenceSection key={def.title} def={def} />
      ))}
    </div>
  );
}

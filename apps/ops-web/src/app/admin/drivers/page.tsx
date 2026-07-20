// apps/ops-web/src/app/admin/drivers/page.tsx
// Thin shell: the full driver CRUD surface now lives in the shared
// DriversAdminSection so the Co so du lieu page renders the SAME component
// without duplication. This standalone route keeps its own page chrome
// (back-link + heading) and remains reachable during the consolidation.
'use client';
import type { JSX } from 'react';
import { DriversAdminSection } from '@/features/admin/DriversAdminSection';
export default function AdminDriversPage(): JSX.Element {
  return (
    <div className='p-6'>
      <div className='mb-4'><a href='/' className='text-blue-600 hover:underline text-sm'>← Quay lại Bảng điều phối</a></div>
      <h1 className='text-2xl font-semibold mb-6'>Quản lý tài xế &amp; xe</h1>
      <DriversAdminSection />
    </div>
  );
}

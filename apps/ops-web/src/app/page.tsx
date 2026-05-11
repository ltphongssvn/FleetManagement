// apps/ops-web/src/app/page.tsx
// Routing entry — dispatcher home: app shell + create order form + live board.
export const dynamic = 'force-dynamic';
import type { JSX } from 'react';
import { cookies } from 'next/headers';
import { CreateOrderForm } from '@/features/dispatch/CreateOrderForm';
import { AppShell } from '@/features/shell/AppShell';
import { loadReferences } from '@/features/dispatch/load-references';

function decodeUsername(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { preferred_username?: string; sub?: string };
    return claims.preferred_username ?? claims.sub;
  } catch {
    return undefined;
  }
}

export default async function HomePage(): Promise<JSX.Element> {
  const cookieStore = await cookies();
  const username = decodeUsername(cookieStore.get('fleet_session')?.value);
  const refs = await loadReferences();
  return (
    <AppShell {...(username ? { username } : {})}>
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">Bảng điều phối</h1>
          <p className="mt-2 text-sm text-slate-300">Tạo và phân công lệnh điều xe cho đội xe.</p>
        </div>
        <CreateOrderForm
          drivers={refs.drivers}
          vehicles={refs.vehicles}
          customers={refs.customers}
          cargoTypes={refs.cargoTypes}
          pickupWarehouses={refs.pickupWarehouses}
          deliveryWarehouses={refs.deliveryWarehouses}
          defaultOrderRef={refs.nextOrderRef}
        />
      </div>
    </AppShell>
  );
}

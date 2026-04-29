// apps/ops-web/src/app/page.tsx
// Routing entry — delegates to feature module.
// Force dynamic rendering: page reads FLEET_API_URL/FLEET_API_TOKEN at request
// time. Static prerender at build time would throw because those env vars are
// only set at runtime in production.
export const dynamic = "force-dynamic";
import type { JSX } from 'react';
import { DispatchBoard } from '@/features/dispatch/DispatchBoard';

export default function HomePage(): JSX.Element {
  return <DispatchBoard />;
}

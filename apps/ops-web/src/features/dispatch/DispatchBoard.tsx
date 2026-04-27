// apps/ops-web/src/features/dispatch/DispatchBoard.tsx
// Dispatch board feature module. RSC by default. Real assignment logic lands week 6+.
import type { JSX } from 'react';
import { getAppVersion } from '@/lib/version';

export function DispatchBoard(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">Fleet Ops v{getAppVersion()}</h1>
    </main>
  );
}

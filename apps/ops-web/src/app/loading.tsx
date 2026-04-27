// apps/ops-web/src/app/loading.tsx
// React Suspense boundary for App Router streaming.
import type { JSX } from 'react';

export default function Loading(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-500">Loading…</p>
    </main>
  );
}

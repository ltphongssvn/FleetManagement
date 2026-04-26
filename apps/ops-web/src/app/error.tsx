// apps/ops-web/src/app/error.tsx
// Error boundary for App Router. Client component (Next.js requirement).
'use client';
import type { JSX } from 'react';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-gray-600">{error.message}</p>
      <button onClick={reset} className="rounded border px-3 py-1">
        Try again
      </button>
    </main>
  );
}

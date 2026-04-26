// apps/ops-web/src/app/global-error.tsx
// Top-level error boundary catching errors in root layout.
'use client';
import type { JSX } from 'react';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4">
          <h2 className="text-lg font-semibold">Application Error</h2>
          <p className="text-sm text-gray-600">{error.message}</p>
          <button onClick={reset} className="rounded border px-3 py-1">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

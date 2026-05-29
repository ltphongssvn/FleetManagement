// apps/ops-web/src/app/global-error.tsx
// Top-level error boundary catching errors in root layout. Reports to Sentry.
'use client';
import { useEffect, type JSX } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  useEffect(() => { Sentry.captureException(error); }, [error]);
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

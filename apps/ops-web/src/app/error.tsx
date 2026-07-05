// apps/ops-web/src/app/error.tsx
// Error boundary for App Router. Client component (Next.js requirement).
// Presentation contract: a boundary receives ARBITRARY internals in the
// caught error (pg strings, env values, stack fragments), so it must never
// render the raw text. Fixed dispatcher Vietnamese + Sentry report instead;
// the raw detail lives in Sentry, not on a dispatcher''s screen.
'use client';
import { useEffect, type JSX } from 'react';
import * as Sentry from '@sentry/nextjs';
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h2 className="text-lg font-semibold">Đã xảy ra lỗi</h2>
      <p className="text-sm text-gray-600">Hệ thống đang gặp sự cố. Vui lòng thử lại.</p>
      <button onClick={reset} className="rounded border px-3 py-1">
        Thử lại
      </button>
    </main>
  );
}

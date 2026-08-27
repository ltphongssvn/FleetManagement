// apps/ops-web/src/app/global-error.tsx
// Top-level error boundary catching errors in root layout. Reports to Sentry.
// Never renders the caught error''s raw text (arbitrary internals); fixed
// dispatcher Vietnamese copy only.
'use client';
import { useEffect, type JSX } from 'react';
import * as Sentry from '@sentry/nextjs';
export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="vi">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4">
          <h2 className="text-lg font-semibold">Đã xảy ra lỗi</h2>
          <p className="text-sm text-gray-600">Hệ thống đang gặp sự cố. Vui lòng thử lại.</p>
          <button onClick={reset} className="rounded border px-3 py-1">
            Thử lại
          </button>
        </main>
      </body>
    </html>
  );
}

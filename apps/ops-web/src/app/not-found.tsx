// apps/ops-web/src/app/not-found.tsx
// 404 boundary for App Router.
import type { JSX } from 'react';

export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-600">Page not found</p>
    </main>
  );
}

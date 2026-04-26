// apps/ops-web/src/app/page.tsx
// Routing entry — delegates to feature module.
import type { JSX } from 'react';
import { DispatchBoard } from '@/features/dispatch/DispatchBoard';

export default function HomePage(): JSX.Element {
  return <DispatchBoard />;
}

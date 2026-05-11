// apps/ops-web/src/app/login/page.tsx
// Login route. Server component renders client LoginForm.
import type { JSX } from 'react';
import { LoginForm } from '@/features/auth/LoginForm';
export const dynamic = 'force-dynamic';
export default function LoginPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <LoginForm />
    </main>
  );
}

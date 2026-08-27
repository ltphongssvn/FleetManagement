// apps/ops-web/src/app/login/page.tsx
// Login route. Server component renders the client LoginForm. When the PKCE
// callback fails it redirects here with ?error=<code>; the page maps that code to
// a friendly message (loginErrorMessage) and passes it as initialError so the
// returning user sees why sign-in did not complete. Reading searchParams keeps
// this route dynamic.
import type { JSX } from 'react';
import { LoginForm } from '@/features/auth/LoginForm';
import { loginErrorMessage } from '@/features/auth/login-error';
export const dynamic = 'force-dynamic';

interface LoginPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const rawError = params['error'];
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;
  const initialError = loginErrorMessage(errorCode);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <LoginForm {...(initialError !== undefined ? { initialError } : {})} />
    </main>
  );
}

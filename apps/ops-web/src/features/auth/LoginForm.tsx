// apps/ops-web/src/features/auth/LoginForm.tsx
// Client component: login form using useActionState (Next.js 16 standard).
'use client';
import { useActionState } from 'react';
import type { JSX } from 'react';
import { login, type LoginState } from './login.action';
export function LoginForm(): JSX.Element {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, undefined);
  const usernameError = state?.status === 'invalid' ? state.errors.username : undefined;
  const passwordError = state?.status === 'invalid' ? state.errors.password : undefined;
  const topError =
    state?.status === 'auth_failed' || state?.status === 'server_error' ? state.message : undefined;
  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4 rounded border border-slate-200 bg-white p-6 shadow">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {topError ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{topError}</p> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="username" className="text-sm font-medium">Username</label>
        <input id="username" name="username" type="text" autoComplete="username" required className="rounded border border-slate-300 px-3 py-2" />
        {usernameError ? <span className="text-xs text-red-600">{usernameError}</span> : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="rounded border border-slate-300 px-3 py-2" />
        {passwordError ? <span className="text-xs text-red-600">{passwordError}</span> : null}
      </div>
      <button type="submit" disabled={pending} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

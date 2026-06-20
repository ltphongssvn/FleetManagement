// apps/ops-web/src/features/auth/LoginForm.tsx
// Client component: the dispatcher web sign-in. With the move to Authorization
// Code + PKCE, ops-web no longer collects credentials - it hands authentication
// to Keycloak (which brokers Google and enforces OTP/WebAuthn). This is a single
// button (labelled in Vietnamese for the dispatcher: "Đăng nhập") that invokes
// the startLogin server action, which redirects the browser to Keycloak's
// authorization endpoint. The only state it renders is a server_error banner
// (e.g. OIDC misconfigured) returned by the action.
'use client';
import { useActionState } from 'react';
import type { JSX } from 'react';
import { startLogin, type LoginState } from './login.action';

// Exported so the action wiring is unit-testable: useActionState ignores the
// previous state + submitted FormData and simply (re)starts the PKCE redirect.
export function submitAction(_prev: LoginState, _formData: FormData): Promise<LoginState> {
  return startLogin();
}

export interface LoginFormProps {
  // A friendly message derived from /login?error= on a failed callback. The
  // page maps the code; LoginForm just renders it when no live error exists.
  readonly initialError?: string;
}
export function LoginForm({ initialError }: LoginFormProps = {}): JSX.Element {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(submitAction, undefined);
  // A live action error (this submit) wins over a stale callback error from the URL.
  const topError =
    state?.status === 'server_error' ? state.message : initialError;
  return (
    <form
      action={formAction}
      className='flex w-full max-w-sm flex-col gap-4 rounded border border-slate-200 bg-white p-6 shadow'
    >
      <h1 className='text-xl font-semibold'>Đăng nhập</h1>
      <p className='text-sm text-slate-600'>
        Nhấn vào nút bên dưới để đăng nhập an toàn vào hệ thống.
      </p>
      {topError ? (
        <p role='alert' className='rounded bg-red-50 px-3 py-2 text-sm text-red-700'>
          {topError}
        </p>
      ) : null}
      <button
        type='submit'
        disabled={pending}
        className='rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50'
      >
        {pending ? 'Đang chuyển hướng…' : 'Đăng nhập'}
      </button>
    </form>
  );
}

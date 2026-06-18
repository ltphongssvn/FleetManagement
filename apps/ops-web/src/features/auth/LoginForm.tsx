// apps/ops-web/src/features/auth/LoginForm.tsx
// Client component: the dispatcher web sign-in. With the move to Authorization
// Code + PKCE, ops-web no longer collects credentials - it hands authentication
// to Keycloak (which brokers Google and enforces OTP/WebAuthn). This is a single
// button that invokes the startLogin server action, which redirects the browser
// to Keycloak's authorization endpoint. The only state it renders is a
// server_error banner (e.g. OIDC misconfigured) returned by the action.
'use client';
import { useActionState } from 'react';
import type { JSX } from 'react';
import { startLogin, type LoginState } from './login.action';

// Exported so the action wiring is unit-testable: useActionState ignores the
// previous state + submitted FormData and simply (re)starts the PKCE redirect.
export function submitAction(_prev: LoginState, _formData: FormData): Promise<LoginState> {
  return startLogin();
}

export function LoginForm(): JSX.Element {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(submitAction, undefined);
  const topError = state?.status === 'server_error' ? state.message : undefined;
  return (
    <form
      action={formAction}
      className='flex w-full max-w-sm flex-col gap-4 rounded border border-slate-200 bg-white p-6 shadow'
    >
      <h1 className='text-xl font-semibold'>Sign in</h1>
      <p className='text-sm text-slate-600'>
        You will be redirected to your organization&apos;s secure sign-in to continue.
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
        {pending ? 'Redirecting…' : 'Continue with Keycloak'}
      </button>
    </form>
  );
}

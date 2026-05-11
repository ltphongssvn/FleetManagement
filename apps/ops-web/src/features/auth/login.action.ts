// apps/ops-web/src/features/auth/login.action.ts
// Server Action: exchanges username/password for JWT via OIDC password grant,
// stores token in httpOnly cookie 'fleet_session'. Industry pattern per
// https://nextjs.org/docs/app/guides/authentication (httpOnly cookie storage).
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
const CredentialsSchema = z.object({
  username: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
});
const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});
export type LoginState =
  | undefined
  | { status: 'invalid'; errors: { username?: string; password?: string } }
  | { status: 'auth_failed'; message: string }
  | { status: 'server_error'; message: string };
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = CredentialsSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    const errors: { username?: string; password?: string } = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (k === 'username' || k === 'password') errors[k] = issue.message;
    }
    return { status: 'invalid', errors };
  }
  const tokenEndpoint = process.env['OIDC_TOKEN_ENDPOINT'];
  if (!tokenEndpoint) return { status: 'server_error', message: 'OIDC_TOKEN_ENDPOINT not configured' };
  const body = new URLSearchParams({
    grant_type: 'password',
    username: parsed.data.username,
    password: parsed.data.password,
    scope: 'fleet',
    client_id: 'ops-web',
    client_secret: 'ops-web-secret',  // pragma: allowlist secret
  });
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) return { status: 'auth_failed', message: 'Invalid username or password' };
  const json: unknown = await res.json();
  const tokenParsed = TokenResponseSchema.safeParse(json);
  if (!tokenParsed.success) return { status: 'server_error', message: 'Invalid token response' };
  const cookieStore = await cookies();
  const maxAge = tokenParsed.data.expires_in ?? 3600;
  cookieStore.set('fleet_session', tokenParsed.data.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  });
  redirect('/');
}

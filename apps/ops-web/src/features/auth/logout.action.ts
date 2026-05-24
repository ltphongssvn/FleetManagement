// apps/ops-web/src/features/auth/logout.action.ts
// Server Action: clears fleet_session cookie and redirects to /login.
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('fleet_session');
  redirect('/login');
}

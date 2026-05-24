// apps/ops-web/src/features/auth/logout.action.ts
// Server Action: clears fleet_session cookie and redirects to /login.
//
// T1 (2026): BEFORE deleting the cookie, fires a fire-and-forget POST to
// /transport-orders-export/auto with trigger='logout'. The API call needs
// the JWT, so the order is: read cookie -> call API -> delete cookie ->
// redirect. Backup failures are swallowed so a transient outage cannot
// trap the user in an authenticated state.
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
async function fireAutoBackup(token: string): Promise<void> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (apiUrl === undefined || apiUrl.length === 0) return;
  try {
    await fetch(apiUrl + '/transport-orders-export/auto', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: 'logout' }),
      cache: 'no-store',
    });
  } catch (err) {
    console.error('auto-backup logout failed:', err);
  }
}
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (token !== undefined && token.length > 0) {
    await fireAutoBackup(token);
  }
  cookieStore.delete('fleet_session');
  redirect('/login');
}

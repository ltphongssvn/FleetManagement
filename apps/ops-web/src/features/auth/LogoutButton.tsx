// apps/ops-web/src/features/auth/LogoutButton.tsx
// Form posting to logout server action. Server-side only state mutation.
import type { JSX } from 'react';
import { logout } from './logout.action';
export function LogoutButton(): JSX.Element {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-100 backdrop-blur transition hover:bg-white/10"
      >
        Đăng xuất
      </button>
    </form>
  );
}

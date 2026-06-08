// apps/ops-web/src/features/admin/revalidate-dispatch.action.ts
'use server';
// Server Action: bust the dispatch route's caches after an admin reference
// mutation (driver-vehicle assign/revoke, create, delete). The dispatch form
// (Số xe / Tài xế dropdowns) is rendered by app/page.tsx (route '/') via
// loadReferences(). An admin mutation happens on a DIFFERENT route, so a
// client-side router.refresh() on the admin page only clears the admin route's
// cache — the '/' Router Cache entry persists and the dropdowns stay stale
// until a hard reload (the MAI HIỀN DIỆU bug). revalidatePath only runs
// server-side and invalidates the route-file's cache (and, per Next.js current
// behavior, all client routes refetch on next navigation), so calling it for
// '/' (layout) is what actually refreshes the dispatch form cross-route. This
// mirrors assign-run.action.ts / cancel-order.action.ts which already
// revalidatePath('/').
import { revalidatePath } from 'next/cache';
// A 'use server' action must be async (the server-action contract), even though
// revalidatePath is synchronous — hence the require-await disable.
// eslint-disable-next-line @typescript-eslint/require-await
export async function revalidateDispatch(): Promise<void> {
  revalidatePath('/', 'layout');
}

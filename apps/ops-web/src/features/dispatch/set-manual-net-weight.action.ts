// apps/ops-web/src/features/dispatch/set-manual-net-weight.action.ts
// T33 Slice D: dispatcher manual net-weight entry as a Next.js Server Action
// (2026 App Router guidance: a human-triggered UI mutation is a Server Action,
// NOT a Route Handler -- no client fetch boilerplate, and revalidatePath busts
// the board cache in the same server roundtrip so the kg + Chenh lech cells
// update immediately).
//
// Security (mandatory even though closures are encrypted in transit): validate
// input with Zod at the trust boundary (Axis-1), read the httpOnly fleet_session
// bearer server-side, and forward to the API PATCH /upload/manual-net-weight.
// The value rule (positive kg) derives from the shared @fleet/sync-protocol
// netWeightKgSchema SSOT so ops-web and the API/worker cannot drift on what a
// valid net weight is (schema-first Axis-2); manifestId is a guid (Axis-1).
//
// Returns a discriminated-union result on every expected path (never throws for
// expected errors): ok | invalid | unauthorized | server_error | conflict |
// api_error. 5xx maps to the immutable Vietnamese server-error copy; raw status
// digits never reach a dispatcher (error-presentation contract).
'use server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { netWeightKgSchema } from '@fleet/sync-protocol';
import { SESSION_COOKIE } from '@/features/auth/session-refresh';

// Axis-1 boundary schema. manifestId is a guid; the weight reuses the shared
// positive-kg SSOT rather than re-declaring z.number().positive() locally.
const SetManualNetWeightInputSchema = z
  .object({
    manifestId: z.guid(),
    extractedNetWeightKg: netWeightKgSchema,
  })
  .strict();

export type SetManualNetWeightInput = z.infer<typeof SetManualNetWeightInputSchema>;

const SERVER_ERROR_VI = 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.';

export type SetManualNetWeightResult =
  | { readonly status: 'ok' }
  | { readonly status: 'invalid' }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'server_error' }
  | { readonly status: 'conflict' }
  | { readonly status: 'api_error'; readonly message: string };

export async function setManualNetWeight(
  input: SetManualNetWeightInput,
): Promise<SetManualNetWeightResult> {
  const parsed = SetManualNetWeightInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid' };

  const apiUrl = process.env['FLEET_API_URL'];
  if (apiUrl === undefined || apiUrl === '') return { status: 'server_error' };

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined) return { status: 'unauthorized' };

  const res = await fetch(apiUrl + '/upload/manual-net-weight', {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (res.ok) {
    // Bust the board so the new kg + recomputed Chenh lech render immediately.
    revalidatePath('/');
    return { status: 'ok' };
  }
  if (res.status === 409) return { status: 'conflict' };
  if (res.status === 401) return { status: 'unauthorized' };
  // Any other non-2xx: never leak raw status digits to a dispatcher.
  return { status: 'api_error', message: SERVER_ERROR_VI };
}

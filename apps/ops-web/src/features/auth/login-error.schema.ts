// apps/ops-web/src/features/auth/login-error.schema.ts
// Schema-first contract for the codes ops-web's /api/auth/callback emits on the
// /login?error=<code> redirect. This enum is the single source of truth for the
// "known" set; the page maps a known code to specific copy and falls back to a
// generic message for any other (free-form, provider-supplied) error param.
import { z } from 'zod';

export const LoginErrorCodeSchema = z.enum([
  'invalid_state',
  'missing_verifier',
  'oidc_not_configured',
  'token_exchange_failed',
  'invalid_token_response',
  'authorization_failed',
]);
export type LoginErrorCode = z.infer<typeof LoginErrorCodeSchema>;

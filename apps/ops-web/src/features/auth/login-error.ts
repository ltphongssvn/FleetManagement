// apps/ops-web/src/features/auth/login-error.ts
// Pure mapping from a /login?error= code to a friendly banner message. Known
// callback codes (validated against LoginErrorCodeSchema) get specific copy;
// any other non-empty value (e.g. a provider error param like access_denied)
// gets a generic fallback; an absent/empty code yields undefined so no banner
// renders. The Record is keyed by the schema-derived union, so adding a code to
// the contract forces a message here at typecheck time.
import { LoginErrorCodeSchema, type LoginErrorCode } from './login-error.schema';

const MESSAGES: Record<LoginErrorCode, string> = {
  invalid_state: 'Your sign-in session expired or could not be verified. Please try again.',
  missing_verifier: 'Your sign-in session expired. Please start sign-in again.',
  oidc_not_configured: 'Sign-in is temporarily unavailable. Please contact your administrator.',
  token_exchange_failed: 'We could not complete sign-in. Please try again.',
  invalid_token_response: 'We could not complete sign-in. Please try again.',
  authorization_failed: 'Sign-in was not completed. Please try again.',
};

const FALLBACK = 'Sign-in was not completed. Please try again.';

export function loginErrorMessage(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw.length === 0) return undefined;
  const parsed = LoginErrorCodeSchema.safeParse(raw);
  return parsed.success ? MESSAGES[parsed.data] : FALLBACK;
}

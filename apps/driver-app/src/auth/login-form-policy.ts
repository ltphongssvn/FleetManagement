// apps/driver-app/src/auth/login-form-policy.ts
export type LoginSubmitDecision =
  | { readonly kind: 'missing-phone' }
  | { readonly kind: 'missing-password' }
  | { readonly kind: 'submit'; readonly phone: string; readonly password: string };

export function decideLoginSubmit(phoneRaw: string, password: string): LoginSubmitDecision {
  const phone = phoneRaw.trim();
  if (phone.length === 0) return { kind: 'missing-phone' };
  if (password.length === 0) return { kind: 'missing-password' };
  return { kind: 'submit', phone, password };
}

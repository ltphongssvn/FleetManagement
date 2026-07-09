// packages/sync-protocol/src/auth-contract.ts
// Zod SSOT for the driver auth wire contract (driver-app-security arc).
// RFC 9700 (OAuth 2.0 Security BCP): public clients receive a short-lived
// access token plus a rotating refresh token; every refresh returns a NEW
// pair and invalidates the old refresh token (reuse revokes the whole
// family, enforced api-side). Strip mode (z.object) is pinned: consumers
// read only known fields, so unknown members do not survive parsing.
import { z } from 'zod';

export const DriverLoginRequestSchema = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});
export type DriverLoginRequest = z.infer<typeof DriverLoginRequestSchema>;

const RotatedPairShape = {
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
};

export const DriverLoginResponseSchema = z.object({
  ...RotatedPairShape,
  driver: z.object({
    driverId: z.guid(),
    operatorId: z.guid(),
    fullName: z.string().min(1).optional(),
  }),
});
export type DriverLoginResponse = z.infer<typeof DriverLoginResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object(RotatedPairShape);
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export function parseDriverLoginResponse(input: unknown): DriverLoginResponse | null {
  const parsed = DriverLoginResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseRefreshResponse(input: unknown): RefreshResponse | null {
  const parsed = RefreshResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

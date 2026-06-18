// e2e/helpers/contracts.ts
// Schema-first contracts for every API boundary the E2E suite reads.
//
// Rationale (2026 best practice — Playwright + Zod contract testing): responses
// crossing into the test are untrusted data, so they are validated at the
// boundary with a Zod schema rather than asserted via a bare `as T` cast (which
// lies to the type-checker and silently passes malformed payloads). Schemas are
// centralized here so the contract lives in one place; the TypeScript types are
// derived from the schemas via z.infer (schema-first: the schema is the source
// of truth, the type follows). These mirror the API's own DTOs in
// apps/api/src (admin-drivers-create.controller, transport-orders.dto,
// reference.dto) so the E2E suite is bound by the same contract the service emits.
import { z } from 'zod';
import type { APIResponse } from '@playwright/test';

// --- Boundary parse helper -------------------------------------------------
// Validates a Playwright APIResponse body against a schema and returns the
// typed, parsed value. Throws a descriptive ZodError if the shape drifts, so a
// contract mismatch fails at the boundary with the offending path, not later as
// a confusing undefined downstream.
export async function parseJson<T>(res: APIResponse, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await res.json();
  return schema.parse(raw);
}

// --- Token endpoint (mock OAuth2 / OIDC) -----------------------------------
// The non-interactive token-factory response. Only access_token is consumed,
// but the standard OIDC fields are modelled and tolerated.
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// --- Admin: driver create --------------------------------------------------
export const CreateDriverResponseSchema = z.object({
  driverId: z.string(),
  operatorId: z.string(),
});
export type CreateDriverResponse = z.infer<typeof CreateDriverResponseSchema>;

// --- Admin: driver-vehicle assignment create -------------------------------
export const AssignmentResponseSchema = z.object({
  assignmentId: z.string(),
});
export type AssignmentResponse = z.infer<typeof AssignmentResponseSchema>;

// --- Reference: create (customer / cargo-type / vehicle / warehouse) -------
export const ReferenceItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  meta: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
});
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;

// --- Reference: list -------------------------------------------------------
export const ReferenceListResponseSchema = z.object({
  items: z.array(ReferenceItemSchema),
});
export type ReferenceListResponse = z.infer<typeof ReferenceListResponseSchema>;

// --- Transport orders: create ----------------------------------------------
// Mirrors apps/api transport-orders.dto.ts CreateTransportOrderResponse: the
// service always assigns externalRef on create, so all three fields are required.
export const CreateTransportOrderResponseSchema = z.object({
  transportOrderId: z.string(),
  roadRunId: z.string(),
  externalRef: z.string(),
});
export type CreateTransportOrderResponse = z.infer<typeof CreateTransportOrderResponseSchema>;

// --- Transport orders: assigned list (BFF /api/transport-orders/assigned) ---
export const AssignedRowSchema = z.object({
  transportOrderId: z.string(),
  state: z.string(),
  externalRef: z.string().nullable().optional(),
});
export type AssignedRow = z.infer<typeof AssignedRowSchema>;

export const AssignedListResponseSchema = z.object({
  rows: z.array(AssignedRowSchema),
});
export type AssignedListResponse = z.infer<typeof AssignedListResponseSchema>;

// --- Driver app: login + identity ------------------------------------------
export const DriverLoginResponseSchema = z.object({
  accessToken: z.string(),
  driver: z.object({ operatorId: z.string().optional() }).optional(),
});
export type DriverLoginResponse = z.infer<typeof DriverLoginResponseSchema>;

export const DriverMeResponseSchema = z.object({
  assignedVehicle: z.object({ vehicleId: z.string().optional() }).nullable().optional(),
});
export type DriverMeResponse = z.infer<typeof DriverMeResponseSchema>;

// --- Admin: reset-password verify (driver /auth/login by phone+password) ----
export const AccessTokenResponseSchema = z.object({
  accessToken: z.string().optional(),
});
export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema>;

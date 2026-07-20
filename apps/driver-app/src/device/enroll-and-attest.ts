// apps/driver-app/src/device/enroll-and-attest.ts
// Keystone entry point for driver device binding (device-binding arc, P6 s3).
// Composes the two device clients into ONE call: self-enroll to obtain the
// server-minted deviceId, then run the attestation handshake to bind it. The
// auth flow integrates device binding by calling THIS function once (Branch-
// By-Abstraction seam), never by wiring the individual clients -- so the
// integration point is a single line and cannot collide at the source level.
//
// Ports are injected so this composes cleanly and stays unit-testable. The
// result is discriminated for the caller to map to Vietnamese UI: bound ->
// proceed; attestation-unavailable -> allow enrollment but surface a notice
// (device pending admin activation without a hardware proof).
export interface AttestOutcome {
  readonly verified: boolean;
  readonly reason?: 'unavailable';
}
export interface EnrollAndAttestPorts {
  enroll(): Promise<string>;
  attest(): Promise<AttestOutcome>;
}
export type EnrollAndAttestResult =
  | { readonly status: 'bound'; readonly deviceId: string }
  | { readonly status: 'attestation-unavailable'; readonly deviceId: string };
export async function enrollAndAttest(ports: EnrollAndAttestPorts): Promise<EnrollAndAttestResult> {
  const deviceId = await ports.enroll();
  const outcome = await ports.attest();
  if (outcome.verified) {
    return { status: 'bound', deviceId };
  }
  return { status: 'attestation-unavailable', deviceId };
}

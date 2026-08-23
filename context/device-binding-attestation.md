<!-- context/device-binding-attestation.md -->

# Device-Binding Hardware Attestation

> Only registered, cryptographically-attested physical devices may reach the driver surface. Android
> Key Attestation and iOS App Attest prove the device is genuine hardware running our unmodified
> app; a TOFU binding lifecycle (pending -> active -> revoked) gates access, activated by an ops-web
> admin. Grounded in 2026 hardware-attestation practice: verify a certificate chain to a pinned
> platform root, never trust a self-reported device id, and keep enforcement dormant until an
> approval surface exists so you cannot lock every driver out.

## Why this exists

The driver app authenticated the _user_ (rotating refresh tokens, RFC 9700) but never the _device_.
A leaked credential, an emulator, or a repackaged APK could talk to the API from anywhere. The
original ask was a secure link between the iOS UUID and an Android hardware id so ops-web only works
with the app on a registered physical device. That framing does not survive contact with 2026
reality:

- **There is no stable Android hardware id.** getSerial/IMEI are permission-gated and return nothing
  to a normal app since Android 10; the ad id is resettable; ANDROID_ID (SSAID) is
  per-app-signing-key and survives only until factory reset. **iOS has no device UUID either** -
  identifierForVendor (IDFV) is per-vendor and resets when the last vendor app is removed. A
  self-reported identifier is a claim, not proof: anything the app can read, a repackaged app can
  forge.
- **The correct primitive is hardware attestation, not an identifier.** Ask the secure element to
  sign a fresh server nonce with a key it generated and cannot export, and return a certificate
  chain proving the key lives in attested hardware. We verify that chain to a pinned platform root.
  The identity we persist (installation id + attested public key) is then bound to hardware we
  cryptographically verified, not to a string the app typed.

## Reference

| Thing               | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Branch / worktree   | feature/device-binding / t7-wt1-device-binding                                     |
| Contract (SSOT)     | packages/sync-protocol/src/device-binding-contract.ts                              |
| Migration           | 0029_unusual_wasp.sql (device_registry binding cols + device_attestation_event)    |
| Trust store         | apps/api/src/device/attestation-trust-store.ts (Google old RSA + new P-384, Apple) |
| Android verifier    | Key Attestation chain (KeyDescription OID, nonce, securityLevel, package)          |
| iOS verifier        | App Attest (CBOR, Apple chain, nonce OID, keyId, rpIdHash, counter, env)           |
| Guard               | apps/api/src/device/device-binding.guard.ts (mode-driven, lockout-safe)            |
| Driver-app keystone | apps/driver-app/src/device/enroll-and-attest.ts                                    |
| Admin endpoints     | admin-device-binding.controller.ts (activate / revoke)                             |

## Architecture (outside-in, contract-first)

1. **Contract SSOT.** One Zod module defines the enrollment request, the attestation-verify
   request/response, the binding-status enum (pending/active/revoked), and the platform
   security-level and environment enums. Every layer derives its types via z.infer; nothing
   redeclares the shape.
2. **Storage.** device_registry gains installation_id, binding_status (default pending), revocation
   columns, and attested-key columns (attestation_public_key_spki, attestation_security_level,
   attestation_environment, attestation_key_id, attestation_counter). device_attestation_event is an
   append-only audit table. A unique index on (company_id, platform, installation_id) makes
   re-enroll idempotent per device.
3. **Verifiers.** Pure functions: chain -> pinned root, parse the platform attestation extension,
   check the server nonce, the security level, the app identity (Android package names / iOS bundle
   ids + Apple team id in rpIdHash), and validity. No I/O in the core, so every branch is unit
   testable.
4. **Service dispatch.** One service dispatches on platform to the right hardware verifier, maps the
   outcome, persists the attested key, and flips the binding to pending for admin review.
5. **Guard (dormant).** DeviceBindingGuard denies any request whose device binding is not active. It
   is mode-driven for a lockout-safe rollout and is applied to ZERO routes until the approval UI
   ships (see safety spine).
6. **Admin.** Activate/revoke endpoints behind the ops-web BFF let an operator move a device pending
   -> active (or revoke it) after reviewing attestation evidence.
7. **Driver app.** getOrCreateInstallationId persists a UUID correlation key in SecureStore; the
   attestation client fetches a nonce, calls the platform attest API
   (getAttestationCertificateChainAsync on Android, getAttestationAsync + keyId on iOS), and posts
   the evidence; enrollAndAttest is the keystone that self-enrolls then attests.

## The safety spine (the rule that orders every remaining step)

**Enforcement must never precede the approval surface.** Every device begins pending. If the guard
is applied to driver routes before ops-web has a screen to move devices to active, every driver is
locked out with no remedy. Therefore the sequence is immovable:

> P7 approval UI (browser-verified) -> P8 apply guard to routes -> enforcement live.

Consequences that look like unfinished work but are deliberate:

- The guard decorates no routes yet (dormant).
- enrollAndAttest is defined but not wired into the auth flow (un-wired keystone).

Both are safe to merge precisely because they change no production behavior. The foundation ships as
dormant infrastructure; the arc stays OPEN (DoD unmet) until P7 UI + P11 on-device round-trip are
verified by hand.

## Lesson: union-arm coverage (the pre-push gate teaches this repeatedly)

A union input reached the 90/90/90/90 branch gate with one arm untested more than once this arc (the
P2 parse-helper miss, the trust-store der-instanceof-Uint8Array ternary). **Every schema/type union
a function branches on must have a spec that exercises BOTH arms.** When a branch is a
genuinely-unreachable defensive guard, mark it with a v8-ignore and a one-line justification rather
than writing a fake test - the same discipline the verifiers use for dead platform guards. Coverage
is the arbiter; the union is where it bites.

## Lesson: migration renumber on develop collision

Long arcs collide on Drizzle migration numbers. This branch authored 0027; while it lived, develop
merged its own 0027 (unaccent) and 0028. On the develop down-merge the journal conflicts and our SQL
is orphaned.

**Resolution pattern (event-sourced, never hand-edit the journal chain):**

1. Take develop journal + snapshot chain wholesale (checkout --theirs the \_journal.json, git rm our
   now-duplicate NNNN SQL + snapshot).
2. Keep the Drizzle schema declarations (they are the source of truth).
3. Re-run db:generate - it diffs the schema against the latest snapshot and emits the next free
   number (here 0029), regenerating our DDL cleanly at the tail of develop chain.
4. **Prove it applies**: the integration suite runs every migration against a real Postgres/PGlite.
   Green there is the verification, not the fact that a file was written.

Corollary defect found the same day (belongs to develop, not this arc): the db:generate
success-marker guard asserts the literal string about a migration file being created, but
drizzle-kit 0.31.10 prints an arrow-glyph variant instead. The guard fails every genuine generation
on no-success-marker even though the file is correct. Fix belongs on develop own branch; noted here
so the next arc does not re-diagnose it.

## Definition of Done (NOT yet met - arc stays open)

- [x] Contract, storage/migration, trust store, both hardware verifiers
- [x] API service dispatch, persist attested key, admin activate/revoke
- [x] Driver-app device identity, attestation client, enrollAndAttest keystone
- [x] Guard built + tested (dormant)
- [ ] P7 ops-web approval UI - **manual browser verification gate**
- [ ] Native @expo/app-integrity adapter (real AppIntegrityPort)
- [ ] Auth-flow keystone wiring (await enrollAndAttest ...)
- [ ] P8 apply guard to driver routes (only after P7 verified)
- [ ] P11 on-device round-trip - real Android + iPhone - **manual verification gate**

## Changelog

- 2026-07-18 - Foundation P2-P6 landed as dormant infrastructure on feature/device-binding: Zod
  contract, migration 0029, pinned trust store, Android Key Attestation + iOS App Attest verifiers,
  API service + admin activate/revoke, driver-app device identity + attestation client +
  enrollAndAttest, and the dormant mode-driven DeviceBindingGuard. Guard applied to no routes and
  keystone un-wired by design (safety spine). Recorded the union-arm coverage rule and the
  migration-renumber-on-collision pattern.

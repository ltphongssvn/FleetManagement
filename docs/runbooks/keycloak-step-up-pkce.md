<!-- docs/runbooks/keycloak-step-up-pkce.md -->

# Keycloak Realm Runbook — Authorization Code + PKCE & Step-Up (corrected-A2, layer C)

Operational counterpart to the corrected-A2 application code. The API enforces
RFC 9470 step-up assurance on `POST /commands`, and ops-web uses the OAuth 2.0
Authorization Code flow with PKCE (RFC 7636) instead of the password grant. This
runbook configures the Keycloak realm so the **deployed** environment actually
serves the PKCE grant ops-web expects and emits the `acr`/`amr` claims the API
checks.

Without this configuration: ops-web login fails (no public PKCE client), and
dispatcher commands return `401` with a `WWW-Authenticate: Bearer
error="insufficient_user_authentication"` challenge (the access token carries no
sufficient `acr`). This is IdP administration — there is no repo code or test for
it; it is the third leg of corrected-A2.

## Scope

In scope: realm ACR→LoA mapping, a public Authorization Code + PKCE client for
ops-web, an authentication flow that forces a second factor for the dispatcher
role, OTP/WebAuthn required actions, `amr` alignment, and Google identity
brokering.

Out of scope: application code (shipped separately), Keycloak installation/HA,
TLS termination, and database setup.

## Prerequisites

- Keycloak 24+ (tested guidance applies through 26.x). Admin access to the target
  realm (referred to below as `<realm>`, e.g. `fleet`).
- The ops-web public hostname (`<ops-web-host>`) and the Keycloak hostname
  (`<kc-host>`), both HTTPS in non-local environments.
- A Google OAuth client (Client ID + secret) for identity brokering.

## Binding contract (application env ⇄ realm objects)

These values are a contract: the realm objects must match what the apps are
configured with. Defaults below are the schema defaults in
`apps/api/src/config/env.config.ts` and `apps/ops-web/src/env.ts`.

| Env var | App | Default | Realm object it must match |
|---|---|---|---|
| `OIDC_AUTHORIZATION_ENDPOINT` | ops-web | (required) | `https://<kc-host>/realms/<realm>/protocol/openid-connect/auth` |
| `OIDC_TOKEN_ENDPOINT` | ops-web | (required) | `https://<kc-host>/realms/<realm>/protocol/openid-connect/token` |
| `OIDC_CLIENT_ID` | ops-web | (required) | Client → Client ID (public) |
| `OIDC_REDIRECT_URI` | ops-web | (required) | Client → Valid redirect URIs (exact match) |
| `OIDC_DISPATCH_ACR_VALUES` | ops-web | (unset) | An ACR string present in the realm ACR→LoA map — set to `aal2` |
| `STEP_UP_ACR_LADDER` | api | `aal1,aal2,aal3` | The ordered set of ACR strings you map in ACR→LoA |
| `STEP_UP_DISPATCH_REQUIRED_ACR` | api | `aal2` | The ACR the dispatcher login must reach |
| `STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT` | api | (boolean) | Whether a phishing-resistant `amr` is also required |
| `STEP_UP_PHISHING_RESISTANT_AMR` | api | `hwk` | The `amr` value your WebAuthn authenticator actually emits (verify — see Step 6) |

## Step 1 — Realm ACR→LoA mapping

Realm settings → General (or "Tokens"/"Advanced" depending on version) → **ACR to
LoA Mapping**. Map each ACR string to a numeric Level of Authentication. The ACR
strings are arbitrary labels; align them to the API's `STEP_UP_ACR_LADDER`:

| ACR | LoA (numeric) |
|---|---|
| `aal1` | 1 |
| `aal2` | 2 |
| `aal3` | 3 |

Best practice is to keep this mapping at the **realm** level (not per-client). The
`acr` claim is added to tokens by the `acr` client scope, which is a realm-default
scope — confirm it is assigned to the ops-web client (Step 2) so the access token
carries `acr`.

## Step 2 — ops-web client (Authorization Code + PKCE, public)

Clients → Create client:

- Client type: **OpenID Connect**; Client ID: the value of `OIDC_CLIENT_ID`.
- **Client authentication: Off** (public client — no secret; PKCE replaces it).
- Authentication flow: **Standard flow** enabled; disable Direct access grants
  (this is what removes the legacy ROPC password grant).
- Valid redirect URIs: exactly `https://<ops-web-host>/api/auth/callback`
  (must equal `OIDC_REDIRECT_URI`; no wildcard in production).
- Advanced → **Proof Key for Code Exchange Code Challenge Method: S256**
  (required — ops-web sends `code_challenge_method=S256`).
- Advanced → Default ACR Values: optionally set `aal2` as a fallback so even a
  request without `acr_values` reaches LoA 2. ops-web already sends
  `acr_values=aal2` when `OIDC_DISPATCH_ACR_VALUES` is set, so this is a
  belt-and-suspenders default.

## Step 3 — Authentication flow: force a second factor for the dispatcher role

Duplicate the built-in **Browser** flow (e.g. `browser-fleet`) and bind it to the
realm (or override on the ops-web client). Within the `forms` sub-flow, after
Username/Password add **two** conditional sub-flows:

1. **Condition - Level of Authentication** (request-driven step-up): configure
   `loa-condition-level = 2`, `loa-max-age` to your session policy. This makes a
   request carrying `acr_values=aal2` require the second factor. Username/Password
   alone = LoA 1; +OTP/WebAuthn = LoA 2.

2. **Condition - User Role = dispatcher** (role-driven mandatory MFA): inside this
   conditional sub-flow, set OTP Form / WebAuthn Authenticator to **Required**. A
   dispatcher is forced through MFA even if `acr_values` were stripped from the
   URL — a defense-in-depth complement to (1) and to the API's server-side check.

Note: because the browser may rewrite `acr_values`, do not rely on it alone.
Consider enabling **PAR** (Pushed Authorization Requests) on the client, and rely
on the API re-checking `acr` in the token (already implemented).

## Step 4 — Required actions: OTP and WebAuthn registration

Authentication → Required Actions:

- Enable **Configure OTP**.
- Toggle **Webauthn Register** ON (and **Webauthn Register Passwordless** if you
  want phishing-resistant passwordless). Set Default Action ON only if every new
  user must enroll immediately.

Realm WebAuthn policy (Authentication → Policies → WebAuthn): set the Relying
Party ID to `<kc-host>` (or your registrable domain), and prefer
`requireResidentKey`/user verification settings appropriate to your assurance bar.

## Step 5 — Google identity brokering

Identity Providers → Add provider → **Google**. Enter the Google Client ID and
secret; the Redirect URI shown by Keycloak must be registered in the Google
console. The realm authentication flow (Step 3) still applies after brokering, so
a dispatcher who signs in via Google is still required to complete the second
factor to reach `aal2`.

## Step 6 — Align `amr` with `STEP_UP_PHISHING_RESISTANT_AMR` (most error-prone step)

If `STEP_UP_DISPATCH_REQUIRE_PHISHING_RESISTANT=true`, the API additionally
requires the token's `amr` to contain a value from `STEP_UP_PHISHING_RESISTANT_AMR`
(default `hwk`). **The exact `amr` string a WebAuthn authenticator emits is
deployment-dependent** — commonly `hwk`, but some Keycloak versions/configs emit
`user`. Do not assume:

1. Complete a real dispatcher login with WebAuthn against the configured realm.
2. Decode the access token and inspect the `amr` array.
3. Set `STEP_UP_PHISHING_RESISTANT_AMR` to the value you actually observe (e.g.
   change the default `hwk` to `user` if that is what Keycloak emits). This is why
   the API keeps it config-driven rather than hard-coded.

Per-authenticator `amr` is configured on the authenticator's settings (e.g.
Password Form → `pwd`, OTP Form → `otp`, WebAuthn → `hwk`/`user`).

## Verification checklist

- Decode an access token from a dispatcher login: `acr` equals `aal2` and, if
  phishing-resistance is required, `amr` contains the configured value.
- `POST /commands` with that token succeeds.
- `POST /commands` with an `aal1`-only token returns `401` and a
  `WWW-Authenticate: Bearer error="insufficient_user_authentication",
  acr_values="aal2"` header.
- ops-web "Continue with Keycloak" round-trips to a logged-in session; tampering
  with the `state` cookie or query yields a `/login?error=invalid_state` banner.

## References

- Code: `apps/api/src/auth/step-up-policy.ts`, `apps/api/src/auth/step-up.guard.ts`,
  `apps/ops-web/src/features/auth/login.action.ts`,
  `apps/ops-web/src/app/api/auth/callback/route.ts`.
- RFC 9470 (Step-Up Authentication Challenge), RFC 9068 (JWT access tokens / `acr`),
  RFC 7636 (PKCE), RFC 9700 (OAuth 2.0 Security BCP).
- Keycloak Server Administration Guide — ACR to LoA Mapping; Configuring
  Authentication (Conditional LoA, WebAuthn).

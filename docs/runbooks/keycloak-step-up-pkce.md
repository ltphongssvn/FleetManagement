<!-- docs/runbooks/keycloak-step-up-pkce.md -->

# Keycloak Realm Runbook — Passwordless Dispatcher Login (Google + WebAuthn passkey, aal3)

Operational counterpart to the ops-web passwordless enforcement. After clicking
**"Đăng nhập"**, the dispatcher is redirected to Keycloak, which shows **only a
"Sign in with Google" button — no username/password form**. Authentication is:
Google identity (brokered) **plus** a phishing-resistant **WebAuthn passkey** on
the dispatcher's phone. Removing the password factor eliminates credential theft.

This runbook configures the Keycloak realm so the **deployed** environment issues
exactly the token ops-web requires. There is no repo code or test for this step —
it is IdP administration — but it is **gated by code**: see the binding contract.

## What the deployed code enforces (the contract — do not drift from this)

`apps/ops-web/src/app/api/auth/callback/route.ts` decodes the access token via the
schema-first contract `apps/ops-web/src/features/auth/oidc-token-claims.schema.ts`
and, in `DISPATCHER_PASSWORDLESS_POLICY`, **refuses any token that does not prove
BOTH**:

| Token claim | Required value | Why |
|---|---|---|
| `idp` | exactly `google` | identity was brokered through Google; no local password login is accepted |
| `acr` | `aal3` | a WebAuthn **passkey** was used; TOTP (`aal2`) is **rejected** for this role |
| `exp` | present (positive int) | no undated token is accepted |
| `aud` | (optional) carries the API audience `fleet-pilot` | API-side audience check |

`acr` is normalized: Keycloak may emit the numeric LoA (`"3"`) or the symbol
(`"aal3"`); both map to `aal3`. The LoA ladder is `aal1 < aal2 < aal3`.

A token that fails decoding or policy NEVER becomes a session. The callback
redirects to one of these (each is a literal the code emits):

| `/login?error=` | Cause |
|---|---|
| `invalid_state` | state cookie ≠ returned state (CSRF) |
| `missing_verifier` | PKCE `code_verifier` cookie absent |
| `oidc_not_configured` | a required `OIDC_*` env var unset |
| `token_exchange_failed` | token endpoint returned non-2xx |
| `invalid_token_response` | token JSON missing `access_token` |
| `invalid_token_claims` | `access_token` is not a decodable JWT |
| `insufficient_acr` | token `acr` below `aal3` (e.g. a TOTP/`aal2` login) |
| `idp_not_brokered` | token `idp` ≠ `google` (e.g. a local password login) |

**Consequence:** the realm MUST be configured per this runbook and verified to emit
`idp=google` + `acr=aal3` **before** the enforcement build is deployed, or every
dispatcher login breaks. To require a different posture (e.g. allow TOTP/`aal2`),
change the policy constant + its tests in code — the realm is not the source of
truth for the bar.

## Prerequisites

- Keycloak 26.3+ (the **Enable Passkeys** switch and automatic passkey browser
  sub-flow land in 26.3; tested through 26.6.x). Admin access to realm `fleet`.
- ops-web public host `<ops-web-host>` (prod: `xe.vominhchau.com`) and Keycloak
  host `<kc-host>` (prod: `keycloak-production-7959.up.railway.app`), both HTTPS.
- A **Google Cloud OAuth 2.0 Client** (Client ID + secret) whose authorized
  redirect URI is `https://<kc-host>/realms/fleet/broker/google/endpoint`.
- The dispatcher uses a device with native passkey support (iOS 16+/Android 9+).

## Binding contract (application env ⇄ realm objects)

| Env var (ops-web) | Value | Realm object it must match |
|---|---|---|
| `OIDC_AUTHORIZATION_ENDPOINT` | `https://<kc-host>/realms/fleet/protocol/openid-connect/auth` | realm authorize endpoint |
| `OIDC_TOKEN_ENDPOINT` | `https://<kc-host>/realms/fleet/protocol/openid-connect/token` | realm token endpoint |
| `OIDC_CLIENT_ID` | `ops-web` | Client → Client ID (public) |
| `OIDC_REDIRECT_URI` | `https://<ops-web-host>/api/auth/callback` | Client → Valid redirect URIs (exact) |
| `OIDC_DISPATCH_ACR_VALUES` | **`aal3`** | an ACR string in the realm ACR→LoA map; drives the passkey step-up |

(The API independently re-checks `acr`/audience on its own endpoints; that is
covered by the API's own configuration and is out of scope here.)

## Step 1 — Realm ACR→LoA mapping

Realm settings → General → **ACR to LoA Mapping**:

| ACR | LoA |
|---|---|
| `aal1` | 1 |
| `aal2` | 2 |
| `aal3` | 3 |

Keep this at the **realm** level. The `acr` claim is added by the realm-default
`acr` client scope — confirm it is assigned to the `ops-web` client so the access
token carries `acr`.

## Step 2 — ops-web client (Authorization Code + PKCE, public)

Clients → `ops-web`:

- Client type **OpenID Connect**; Client ID `ops-web`.
- **Client authentication: Off** (public; PKCE replaces the secret).
- **Standard flow: On**; **Direct access grants: Off** (no ROPC password path).
- Valid redirect URIs: exactly `https://<ops-web-host>/api/auth/callback`.
- Web origins: `https://<ops-web-host>`.
- Advanced → Default ACR Values: `aal3` (belt-and-suspenders; ops-web already
  sends `acr_values=aal3`).
- Confirm assigned client scopes include `acr`, `fleet`, and the dedicated scope
  used in Steps 3 and 6.

## Step 3 — Google-only sign-in (no username/password form)

Goal: the Keycloak screen offers **only "Sign in with Google"**.

1. Identity Providers → Add provider → **Google**. Enter the Google Cloud Client
   ID + secret. The broker **alias must be exactly `google`** (the value ops-web
   requires in the `idp` claim). Register Keycloak's redirect URI
   `https://<kc-host>/realms/fleet/broker/google/endpoint` in Google Cloud.
2. Authentication → duplicate the **Browser** flow as `browser-passwordless`.
   Remove the Username-Password-Forms sub-flow and add an **Identity Provider
   Redirector** execution with **Default Identity Provider = `google`**. This
   sends the user straight to Google instead of rendering any credential form.
3. Bind `browser-passwordless` as the realm Browser flow (Authentication → Flows →
   Action → Bind flow → Browser), or override it on the `ops-web` client.
4. Remove any local password credential from the dispatcher user so no password
   path can exist.

## Step 4 — WebAuthn passkey → acr=aal3

1. Authentication → Policies → **WebAuthn Passwordless Policy**:
   - **Enable Passkeys: ON** (26.3+ auto-wires the passkey sub-flow; no manual flow
     surgery needed).
   - Relying Party ID: `<kc-host>` registrable domain.
   - **Require Discoverable Credentials: Yes**; User Verification: **required**
     (makes it usernameless and presence-verified — aal3-grade).
2. Authentication → Required Actions → enable **Webauthn Register Passwordless**
   (Default Action ON so the dispatcher enrols their phone passkey on first login).
3. Stamp the passkey login as LoA 3: in the post-broker step-up sub-flow, gate the
   WebAuthn Passwordless authenticator behind **Condition - Level of
   Authentication** with `loa-condition-level = 3`. A completed passkey login is
   then issued `acr=aal3` via the Step 1 map. Net dispatcher proof: Google identity
   (Step 3) **+** passkey presence (this step).

## Step 5 — (No TOTP.) Confirm aal2/TOTP cannot satisfy the gate

Do **not** add an OTP Form to the passwordless flow. The policy floor is `aal3`;
a TOTP login reaches only `aal2` and the callback rejects it with
`insufficient_acr`. This is intentional — a passkey is phishing-resistant, TOTP is
not. (Changing this requires editing `DISPATCHER_PASSWORDLESS_POLICY` and its tests
in code, not the realm.)

## Step 6 — Emit the `idp` claim (the piece that makes enforcement work)

`idp` is **NOT** a default token claim. After a brokered login Keycloak stores the
broker alias as the **`identity_provider` user session note**; you must propagate
it into the access token:

Clients → `ops-web` → Client scopes → `ops-web-dedicated` → **Add mapper → By
configuration → User Session Note**:

- Name: `idp`
- User Session Note: `identity_provider`
- Token Claim Name: `idp`
- Claim JSON Type: String
- **Add to access token: ON**

Without this mapper the access token has no `idp` claim and ops-web rejects every
login with `idp_not_brokered`. The broker alias from Step 3 must be exactly
`google` so the claim value matches.

(Existing mappers from earlier setup remain: `operator_id` and `company_id` User
Attribute mappers, and the `fleet-pilot` Audience mapper. Keep them.)

## Step 7 — Verify BEFORE deploying the enforcement build

1. Clients → `ops-web` → Client scopes → **Evaluate**: pick the dispatcher user,
   generate the access token, and confirm the payload contains **`idp": "google"`**
   and **`acr": "aal3"`** (or `"3"`), plus `aud` containing `fleet-pilot`.
2. Only after both claims verify, deploy the enforcement build, then run the live
   login: **"Đăng nhập" → Google → passkey →** lands on the dispatch board
   ("Bảng điều phối"); DevTools shows `fleet_session` set and the `oidc_*`
   transient cookies cleared.
3. Negative checks (any path that still issues a weaker token):
   - a non-passkey login ⇒ `/login?error=insufficient_acr`, no session;
   - a non-Google login ⇒ `/login?error=idp_not_brokered`, no session.

## References

- Code (source of truth): `apps/ops-web/src/features/auth/oidc-token-claims.schema.ts`
  (the contract + `DISPATCHER_PASSWORDLESS_POLICY`),
  `apps/ops-web/src/app/api/auth/callback/route.ts` (enforcement),
  `apps/ops-web/src/features/auth/login.action.ts` (requests `acr_values=aal3`).
- Keycloak Server Administration Guide (26.6) — Passkeys; W3C Web Authentication
  (WebAuthn) → Passwordless; Integrating identity providers → Mapping claims and
  assertions (User Session Note `identity_provider`); Controlling login options →
  ACR to LoA Mapping; Authentication flows → Identity Provider Redirector + step-up.
- Keycloak 26.3 release notes — "Enable Passkeys" switch (WebAuthn Passwordless
  Policy).
- RFC 9068 (JWT access tokens / `acr`), RFC 7636 (PKCE), RFC 9700 (OAuth 2.0
  Security BCP), RFC 9470 (Step-Up Authentication Challenge).

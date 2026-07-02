<!-- context/keycloak-break-glass-runbook.md -->
# Keycloak Break-Glass & Admin Recovery Runbook

> Emergency admin access for the `fleet` Keycloak on Railway. What the standing posture
> is, how to keep it healthy, and exactly what to do when access is lost. Grounded in
> 2026 break-glass practice (isolated-from-daily-ops, a sealed emergency tier with its own
> redundancy, permanent privilege, vaulted creds, monitored, drilled).

## Why this exists

**Incident 2026-07-01.** The realm had a single standing admin (`fleet-admin`); its
password was lost and the original bootstrap `admin` had already been deleted during
hardening -> full lockout. Recovery required the Keycloak 26 container-side
`kc.sh bootstrap-admin user` command (with the management port relocated to dodge a
`:9000` "Address already in use" collision). Root lesson: one admin is a single point of
failure, and the recovery path must be tested and documented BEFORE you need it.

## Standing posture (target state)

Strict enterprise separation: the account used for day-to-day work is NOT part of the
emergency tier, and the emergency tier itself is redundant.

- **Day-to-day admin (operational):** `fleet-admin`. Used for routine Keycloak
  administration. Local (username/password, non-Google).
- **Sealed break-glass tier (emergency only):** `fleet-breakglass-1` and
  `fleet-breakglass-2` - two accounts so the sealed tier has its own redundancy. Both
  local (non-Google), both hold the `admin` role, both NEVER used for routine work.
  - *Local* means they authenticate with username + password directly against the
    `master` realm and do NOT go through Google. That is the whole point of break-glass:
    they must still work when the federated IdP (Google) or the broker is down.
- **All three credentials live ONLY in Dashlane** (long, random, >=24 chars), never
  committed, never in shell history. Rotate after any use.
- The sealed accounts are fire extinguishers: break the seal only in an emergency.

## Reference

| Thing | Value |
| --- | --- |
| Keycloak host | `keycloak-production-7959.up.railway.app` (Railway service `Keycloak`) |
| Version | Keycloak 26.6.3 (JVM 21) |
| Admin realm | `master` (username/password login) |
| Admin console | `https://keycloak-production-7959.up.railway.app/admin` |
| Recovery script | `scripts/keycloak-break-glass.sh` |
| Container recovery binary | `/opt/keycloak/bin/kc.sh` |
| Day-to-day admin | `fleet-admin` |
| Sealed break-glass | `fleet-breakglass-1`, `fleet-breakglass-2` |

## Procedure A - create / re-create a sealed break-glass admin

Naming convention: `fleet-breakglass-N`. Do this in the Admin Console while signed in as
any working master-realm admin.

1. Confirm the realm switcher (top-left) shows **master**.
2. **Users -> Add user**: Username `fleet-breakglass-N`; leave "Required user actions"
   empty; Create. (Email optional; do not enable email-verification actions - the account
   is local, not Google-linked. A "no email" warning icon on the user is expected and
   harmless.)
3. Open the user -> **Credentials -> Set password**: paste a fresh long random password
   generated in Dashlane; **Temporary = Off**; Save + confirm. Store it in Dashlane
   immediately, labelled distinctly, e.g. "Keycloak master - fleet-breakglass-N
   (break-glass)".
4. **Role mapping -> Assign role -> Realm roles**: assign **`admin`**. Result should read
   `admin` + `default-roles-master`, matching `fleet-admin` exactly. `admin` alone is the
   whole grant; add nothing else.
5. **Do NOT** link it to the Google identity provider. It stays local on purpose.
6. Verify (decisive): fresh incognito -> the admin console URL -> sign in as
   `fleet-breakglass-N` -> confirm full admin access. A sealed account never proven to log
   in is not real redundancy.

## Procedure B - quarterly break-glass drill (every 90 days)

Break-glass accounts rot silently; test them like fire alarms.

1. In a fresh incognito, log into the admin console as **each** account -
   `fleet-admin`, `fleet-breakglass-1`, `fleet-breakglass-2` - to confirm no password is
   stale.
2. Confirm the doomsday path is still wired: run
   `scripts/keycloak-break-glass.sh preflight` and check it prints the Keycloak version
   and the `kc.sh` listing (container SSH + binary intact).
3. Record the drill date in the Changelog below.

## Procedure C - last-resort recovery (ALL admins locked out)

Only when `fleet-admin` AND both `fleet-breakglass-1/2` are unusable.

1. Run `scripts/keycloak-break-glass.sh recover`.
2. Follow the printed AFTER steps: log into the console as the temporary user, reset a
   standing admin (Users -> <admin> -> Credentials, Temporary=Off), verify that admin in a
   SEPARATE incognito window, then DELETE the temporary user.
3. Rotate the reset password in Dashlane and log the event.

Notes baked into the script (why it works): the temporary Keycloak it launches has its
management interface moved to a free port (`KC_HTTP_MANAGEMENT_PORT`, default 9990) so it
does not collide with the live server's `:9000`; the temp username is timestamped so
re-runs never hit a duplicate-key error; and the temp password is generated inside the
container and passed via `--password:env`, so it never touches your local shell history.

## Procedure D - cleanup of temporary admins

Temporary admins (from recovery) show a yellow "temporary admin" banner.

1. After any recovery, delete every temporary admin: Users -> <temp> -> Delete.
2. Confirm only the standing accounts remain: `fleet-admin`, `fleet-breakglass-1`,
   `fleet-breakglass-2`.

## Incident hygiene (after any break-glass use)

- Rotate the used account's password in Dashlane.
- Delete any temporary admins created during the event.
- Add a dated line to the Changelog describing what happened and why.

## Monitoring (TODO - not yet wired)

Master-realm admin logins should be rare; a `fleet-breakglass-*` login especially so. Wire
Keycloak admin/login events for the `master` realm into the existing OTel/Sentry pipeline
and alert on any master-realm admin sign-in - and page on any break-glass login. Until
that exists, this is a manual review item during the quarterly drill.

## Naming note

Names are deliberately descriptive (`fleet-breakglass-1/2`), per 2026 guidance: attackers
target privilege, not account names, and responders must be able to identify these
accounts instantly. Security comes from strong vaulted credentials plus monitoring - not
obscurity. The `-N` suffix makes the sealed tier's redundancy obvious at a glance.

## Changelog

- 2026-07-01 - Lockout recovered: `fleet-admin` password reset via
  `kc.sh bootstrap-admin user` (management port relocated to 9990 to clear a `:9000`
  collision). Added `scripts/keycloak-break-glass.sh`. Adopted strict posture:
  `fleet-admin` as day-to-day admin plus a sealed break-glass tier of two accounts,
  `fleet-breakglass-1` and `fleet-breakglass-2` (both `admin` role, local, vaulted in
  Dashlane). Removed temporary `recovery-admin2` (the stray `recovery-admin` never
  persisted). All three admin passwords confirmed vaulted.

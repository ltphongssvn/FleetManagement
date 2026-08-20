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
| Image | pinned by DIGEST, never `:latest` (see DEPLOY.md) |
| Container memory | 1 GB limit - load-bearing, see DEPLOY.md. Never remove. |
| Admin realm | `master` (username/password login) |
| Admin console | `https://keycloak-production-7959.up.railway.app/admin` |
| Recovery script | `scripts/keycloak-break-glass.sh` |
| Container recovery binary | `/opt/keycloak/bin/kc.sh` |
| Day-to-day admin | `fleet-admin` |
| Sealed break-glass | `fleet-breakglass-1`, `fleet-breakglass-2` |
| Monitor service account | `fleet-breakglass-monitor` (master realm client) |

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

## Procedure E - rotate the monitor client secret

Do this after any exposure of `KEYCLOAK_MONITOR_CLIENT_SECRET` - including a value that
merely reached a terminal scrollback or a chat transcript. A leaked secret on the
security monitor is the worst class to leave: it authenticates the thing that watches
for break-glass logins.

1. Admin Console -> realm **master** -> **Clients** -> `fleet-breakglass-monitor` ->
   **Credentials** -> **Regenerate** (the Client Secret one, NOT Registration access
   token). Copy it.
2. Store in Dashlane as "Keycloak master - fleet-breakglass-monitor (client secret)".
3. Set it on the Railway API service WITHOUT it reaching argv, history or scrollback -
   `railway variable set ... --stdin` requires a pipe, so read it hidden first:

```bash
printf 'Paste secret (hidden): ' && read -rs KC_MON && echo && \
printf '%s' "$KC_MON" | railway variable set KEYCLOAK_MONITOR_CLIENT_SECRET --stdin --service api ; \
unset KC_MON
```

4. Verify the API came back: `curl -s https://api-production-fd42.up.railway.app/health/ready`
   must return `{"status":"ok","database":"up"}`.
5. Log the rotation in the Changelog. The monitor cannot authenticate between step 1 and
   step 3, so keep that window short.

NEVER read the secret back with `railway variables --kv`, which prints raw values. Use
`| cut -d= -f1` when you only need to confirm a variable EXISTS.

## Incident hygiene (after any break-glass use)

- Rotate the used account's password in Dashlane.
- Delete any temporary admins created during the event.
- Add a dated line to the Changelog describing what happened and why.

## Monitoring (armed; alert rule pending)

A `fleet-breakglass-*` login should be near-zero-frequency, so every one is high-signal.
The API-side monitor is built and wired: a 60s self-scheduling tick in `SchedulerService`
polls the master-realm login-events API as the read-only `fleet-breakglass-monitor` service
account and emits a Sentry `fatal` event (fingerprint `keycloak-breakglass-login`, tag
`security_event=keycloak_breakglass_login`) for any break-glass sign-in, advancing a durable
Postgres cursor (`keycloak_event_poll_cursor`) so each login pages exactly once.

Activation status:
  1. DONE (2026-08-20) - `KEYCLOAK_MONITOR_CLIENT_SECRET` is set on the Railway API
     service, so the factory yields a provider and the tick schedules.
  2. PENDING - a Sentry alert rule that pages (PagerDuty/Opsgenie/email) on the
     `keycloak-breakglass-login` fingerprint / `security_event` tag at level fatal.

Until step 2 lands the event is RECORDED in Sentry but pages nobody, so a break-glass
login is still caught only by manual review during the drill.

## Naming note

Names are deliberately descriptive (`fleet-breakglass-1/2`), per 2026 guidance: attackers
target privilege, not account names, and responders must be able to identify these
accounts instantly. Security comes from strong vaulted credentials plus monitoring - not
obscurity. The `-N` suffix makes the sealed tier's redundancy obvious at a glance.

## Changelog

- 2026-08-20 - Rotated the `fleet-breakglass-monitor` client secret: the previous value
  was printed in full by `railway variables --service api --kv` during a cost
  investigation and reached a terminal scrollback. Set on the API service via a hidden
  read piped to `--stdin`; API verified healthy afterwards. Monitoring step 1 is now
  DONE, so the tick schedules; the Sentry alert rule (step 2) is still outstanding.
  Added Procedure E so the rotation is a documented op rather than improvised.
- 2026-08-20 - Keycloak platform hardening (see DEPLOY.md): container memory bounded at
  1 GB, image pinned by digest, moved from `us-west2` to `asia-southeast1-eqsg3a`,
  restart retries 3, `KC_HOSTNAME_STRICT=true` with `KC_HOSTNAME` set,
  `KC_METRICS_ENABLED=false`, `KC_BOOTSTRAP_ADMIN_*` removed (the admin exists; those
  only seed an empty DB). Health probing wired via
  `KC_HTTP_MANAGEMENT_HEALTH_ENABLED=false`, which keeps `/health` on the main port.
  NOTE: setting `KC_HTTP_MANAGEMENT_PORT=8080` instead took Keycloak DOWN (503 on every
  endpoint, rolled back in ~75s) - Quarkus routes management vs main traffic BY PORT, so
  equal ports collide and the server never starts. That is the same `:9000` collision
  class this runbook already records from 2026-07-01; the knowledge existed and was not
  consulted first.
- 2026-07-01 - Lockout recovered: `fleet-admin` password reset via
  `kc.sh bootstrap-admin user` (management port relocated to 9990 to clear a `:9000`
  collision). Added `scripts/keycloak-break-glass.sh`. Adopted strict posture:
  `fleet-admin` as day-to-day admin plus a sealed break-glass tier of two accounts,
  `fleet-breakglass-1` and `fleet-breakglass-2` (both `admin` role, local, vaulted in
  Dashlane). Removed temporary `recovery-admin2` (the stray `recovery-admin` never
  persisted). All three admin passwords confirmed vaulted.

#!/usr/bin/env bash
# scripts/keycloak-break-glass.sh
# keycloak-break-glass.sh — last-resort recovery of admin access to the `fleet`
# Keycloak realm on Railway, for when ALL standing master-realm admins are locked out.
#
# THIS IS THE DOOMSDAY TOOL. First-line resilience is TWO standing, LOCAL (non-Google)
# master-realm admins whose passwords live in Dashlane. Only reach for this script when
# both of those accounts are unusable. See context/keycloak-break-glass-runbook.md.
#
# What it does: shells into the running Keycloak container via `railway ssh` and runs
# Keycloak 26's dedicated `kc.sh bootstrap-admin user` command to mint a TEMPORARY
# master-realm admin, printing its one-time credentials. You then log into the Admin
# Console with it, reset a real standing admin, verify, and DELETE the temporary one.
#
# Hard-won specifics baked in (proven against Keycloak 26.6.3 on Railway, 2026-07):
#   * Management interface relocated to a free port via KC_HTTP_MANAGEMENT_PORT so the
#     throwaway process does not collide with the live server's :9000
#     (the "Address already in use / Unable to start the management interface" failure).
#   * Fresh, timestamped username each run, so re-runs never hit the duplicate-key error.
#   * Password generated INSIDE the container from the kernel RNG and passed via
#     --password:env, so it never lands in your local shell history or process args.
#   * DB options are inherited from the container env (KC_DB_*), i.e. the same options
#     the live server runs with — as the Keycloak recovery docs recommend.
# We deliberately do NOT pass --optimized: the plain command is what we proved working,
# and Railway's ephemeral container FS discards any transient build on the next restart.
set -euo pipefail

# ---- config (override via env) ------------------------------------------------
KC_SERVICE="${KC_SERVICE:-Keycloak}"            # Railway service name
KC_BIN="${KC_BIN:-/opt/keycloak/bin/kc.sh}"     # kc.sh path inside the container
KC_MGMT_PORT="${KC_MGMT_PORT:-9990}"            # free port for the throwaway mgmt iface
KC_ADMIN_URL="${KC_ADMIN_URL:-https://keycloak-production-7959.up.railway.app/admin}"
USERNAME_PREFIX="${USERNAME_PREFIX:-breakglass}"
ASSUME_YES="${ASSUME_YES:-0}"

c_blue=$'\033[1;34m'; c_red=$'\033[1;31m'; c_yel=$'\033[1;33m'; c_off=$'\033[0m'
log()  { printf '%s[break-glass]%s %s\n' "$c_blue" "$c_off" "$*" >&2; }
warn() { printf '%s[break-glass]%s %s\n' "$c_yel"  "$c_off" "$*" >&2; }
die()  { printf '%s[break-glass] ERROR:%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

need_railway() {
  command -v railway >/dev/null 2>&1 \
    || die "railway CLI not found on PATH. Install it, then 'railway link' this repo and 'railway ssh keys add'."
}

usage() {
  cat >&2 <<'USAGE'
keycloak-break-glass.sh — last-resort Keycloak admin recovery (Railway + Keycloak 26)

USAGE:
  scripts/keycloak-break-glass.sh preflight   Verify container access + kc.sh, print KC version
  scripts/keycloak-break-glass.sh recover     Mint a TEMPORARY master-realm admin, print its creds
  scripts/keycloak-break-glass.sh --help

FLAGS:
  -y, --yes    Skip the confirmation prompt (for scripted/urgent use)

AFTER `recover` (do all of these):
  1. Log into the Admin Console as the printed temporary user.
  2. Reset a STANDING admin's password (Users -> <admin> -> Credentials, Temporary=Off).
  3. Verify that standing admin in a SEPARATE incognito window BEFORE deleting anything.
  4. DELETE the temporary user (Users -> <temp> -> Delete) — it must not persist.
  5. Rotate the standing admin password and record it in Dashlane.

ENV OVERRIDES: KC_SERVICE, KC_BIN, KC_MGMT_PORT, KC_ADMIN_URL, USERNAME_PREFIX
USAGE
}

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  printf '%s[break-glass]%s Mint a TEMPORARY superadmin on Keycloak service "%s"? [y/N] ' \
    "$c_yel" "$c_off" "$KC_SERVICE" >&2
  local reply=""; read -r reply </dev/tty 2>/dev/null || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) die "Aborted." ;; esac
}

preflight() {
  need_railway
  log "Checking container access + kc.sh on service '$KC_SERVICE'..."
  echo "$KC_BIN --version 2>&1 | head -3; echo '=== kc.sh ==='; ls -la $KC_BIN" \
    | railway ssh --service "$KC_SERVICE" \
    || die "railway ssh failed. Check: linked project; a registered key (railway ssh keys add); service name (KC_SERVICE=$KC_SERVICE)."
}

recover() {
  need_railway
  confirm
  local uname="${USERNAME_PREFIX}-$(date +%s)"
  log "Minting temporary admin '$uname' (service '$KC_SERVICE', mgmt port $KC_MGMT_PORT)..."
  local remote
  remote=$(cat <<REMOTE
export KC_HTTP_MANAGEMENT_PORT=${KC_MGMT_PORT}
export BG_PW="\$(cat /proc/sys/kernel/random/uuid)"
${KC_BIN} bootstrap-admin user --username ${uname} --password:env BG_PW --no-prompt
printf '=== TEMP BREAK-GLASS LOGIN (delete after use) ===\n'
printf 'admin console: ${KC_ADMIN_URL}\n'
printf 'username: ${uname}\n'
printf 'password: %s\n' "\$BG_PW"
REMOTE
)
  echo "$remote" | railway ssh --service "$KC_SERVICE" || die \
"Recovery failed. If 'Address already in use', set KC_MGMT_PORT to another free port and retry. If 'duplicate key', a temp admin of this name exists (rare — name is timestamped); just re-run."
  log "Success. Now do the AFTER steps (--help): log in, reset a standing admin, verify, DELETE this temp user, rotate in Dashlane."
}

cmd="${1:-}"; [ $# -gt 0 ] && shift || true
for arg in "$@"; do case "$arg" in -y|--yes) ASSUME_YES=1 ;; esac; done
case "$cmd" in
  preflight) preflight ;;
  recover)   recover ;;
  -h|--help|help|"") usage ;;
  *) die "Unknown command: $cmd (see --help)" ;;
esac

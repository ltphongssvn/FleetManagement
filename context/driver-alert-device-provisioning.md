# Driver-alert device provisioning checklist (T12)

The server-side pipeline (order -> outbox -> relay -> BullMQ -> consumer -> Expo
push) is guarded by the alert-lag monitor (Sentry fatal, fingerprint
driver-alert-pipeline-stalled). But the LAST hop -- FCM/APNs waking a specific
phone loudly enough to move a driver at 4AM -- depends on per-device settings
the server cannot see or fix. This checklist is the operational guardrail for
that hop. Run it on every pilot phone at handout, and re-run after any OS
update (HyperOS/OneUI updates silently reset notification and battery policy).

## Why this is not optional

A missed alert = a missed truck run. The native channel is configured for
maximum reach (importance MAX, ALARM audio usage so it plays through a silenced
ringer, bypassDnd, lockscreen PUBLIC), but three device-level policies can
still suppress it: aggressive battery management killing the app, autostart
restrictions preventing background delivery, and per-app notification toggles
the driver may flip off by accident. Vietnamese-market Xiaomi/Redmi (HyperOS,
formerly MIUI) is the most aggressive; Samsung (OneUI) and Oppo/vivo similar.

## Per-phone checklist (driver present, do together)

1. Install the release build (NOT a dev/Expo Go build -- see the cold-start
   caveat below). Log in once so the push token registers.
2. Grant the notification permission when prompted (Android 13+ POST_
   NOTIFICATIONS is a runtime grant; a denied prompt means zero alerts).
3. Open Settings -> Apps -> (the driver app) -> Notifications and confirm the
   channel named in Vietnamese (Lenh dieu xe) is ON with sound and is allowed
   to override Do Not Disturb.
4. Battery: set the app to No restrictions / Unrestricted (HyperOS: Settings
   -> Battery -> app -> No restrictions AND Autostart ON; OneUI: Settings ->
   Battery -> Background usage limits -> remove from sleeping/deep-sleeping
   lists). This is the single most common cause of a phone going silent
   overnight.
5. Lock the app in the recents view (HyperOS: swipe down on the app card ->
   lock) so the task killer cannot swipe it away.
6. Confirm the custom alert sound plays: send a test order from ops-web and
   verify the phone RINGS with the transport_alert tone, shows a heads-up
   banner, and a tap opens the order screen.
7. Repeat step 6 with the phone (a) on silent/vibrate, (b) in Do Not Disturb,
   and (c) locked and idle for 10+ minutes (Doze). All three must still ring.

## Cold-start caveat (dev vs release builds)

When the app is KILLED and launched by TAPPING the alert, the app reads the
initial notification response on boot (getLastNotificationResponse, wired in
app/_layout.tsx) to route the tap to the order. This path is documented as
UNRELIABLE in Android development builds (it can return null) but works in
release builds. Always DoD-verify the cold-start tap on a release build, never
a dev build, or the 4AM killed-app tap will appear broken when it is not.

## iOS notes

iOS has no autostart/battery-killer equivalent; delivery mechanics ride on the
per-message interruptionLevel (time-sensitive) the API sender stamps. Confirm:
notification permission granted (alert + sound), Focus/Do Not Disturb allows
the app or the time-sensitive interruption level is permitted, and the ringer
is not hardware-muted (time-sensitive plays through Focus but NOT through the
hardware mute switch -- brief the driver). allowCriticalAlerts is deliberately
NOT used (it needs an Apple entitlement we do not hold).

## When the monitor pages anyway

If the alert-lag monitor fires (driver-alert-pipeline-stalled) the break is
SERVER-side (relay/queue/consumer), not device -- this checklist will not help.
See the pipeline: outbox rows with aggregateType=driver_alert stuck pending/
failed or in dead_letter. Device provisioning covers only the last hop.

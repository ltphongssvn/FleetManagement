// apps/driver-app/app/(app)/assignments.tsx
// Driver assignments list. Each card shows the order, a per-warehouse capture
// (proof) button for EVERY stop, plus ONE context-aware lifecycle action button
// (Nhận lệnh / Bắt đầu chuyến / Hoàn thành) driven by the road_run state.
// Tapping the lifecycle button calls the delivery-lifecycle endpoint; on
// success the list refetches so the card reflects the new state. The state
// change is also what the dispatcher's board reads, so accepting an order
// is the driver's acknowledgement back to dispatch.
//
// Per-warehouse capture: each stop row is a button that deep-links to the
// manifest-photo proof screen for THAT warehouse, passing the capture
// descriptor (stopKind + stopIndex) from presentAssignmentStops via
// captureHrefForStop. This is how the driver photographs the weighing receipt
// as pickup/delivery proof at each destination (loading 1..N + the unloading
// warehouse). Passing the descriptor is required: a bare /capture link renders
// the invalid_stop screen.
//
// Delivery-capture gate (2026 phase-gate invariant), enforced as UX in TWO ways:
//   - PREVENTION (describeCaptureLock, at render): a delivery stop whose pickups
//     are not all photographed shows a visibly LOCKED button with a short
//     Vietnamese guidance caption, so the driver is taught the correct procedure
//     BEFORE tapping (2026 mobile-UX: prevent the error, do not just scold it).
//   - FALLBACK (decideCapturePress, on tap): if tapped anyway, a Vietnamese
//     educational Alert explains what to do and which pickups remain.
// Both consult the shared @fleet/domain rule; the 'remaining' auto-advance count
// is sourced from hasManifest (committed-proof truth), not departedAt. The
// server commit endpoint re-enforces the same rule, so this is the UX layer of a
// one-rule / two-surface enforcement. Pickups are order-independent.
//
// Server state — the list and the lifecycle transitions — is owned by the
// useAssignments TanStack Query hook: useQuery for the list, useMutation for
// accept/start/complete with automatic list invalidation on success. This
// screen no longer runs its own useEffect/useState fetch or manual refetch.
import type { JSX } from 'react';
import { useRouter, type Href } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { useAssignments } from '../../src/assignments/use-assignments.js';
import { presentAssignmentStops } from '../../src/assignments/assignment-stops-presenter.js';
import { roadRunStateLabelVi } from '../../src/assignments/road-run-state-label.js';
import { captureHrefForStop } from '../../src/assignments/capture-href.js';
import { decideCapturePress, describeCaptureLock } from '../../src/assignments/card-capture-press.js';
import { presentApiError } from '../../src/errors/present-api-error.js';
import { formatVnDateUS } from '../../src/config/vn-locale.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
// Road-run state -> badge colour. Unknown states fall back to slate.
const STATE_COLOR: Record<string, string> = {
  planned: colors.slate500,
  dispatched: colors.indigo600,
  started: colors.amber500,
  completed: colors.green600,
};
export default function Assignments(): JSX.Element {
  // Lifecycle transitions are photo-driven now (no manual buttons); the
  // list only reads server state and refetches after each capture.
  const { query } = useAssignments();
  const router = useRouter();
  if (query.isPending) {
    return (
      <View style={styles.center} testID={'loading'}>
        <ActivityIndicator size={'large'} color={colors.indigo500} />
        <Text style={styles.muted}>Đang tải lệnh điều xe…</Text>
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={styles.center} testID={'error'}>
        <Text style={styles.errorTitle}>Lỗi tải dữ liệu</Text>
        <Text style={styles.muted}>
          {presentApiError(query.error, 'Lỗi tải dữ liệu')}
        </Text>
      </View>
    );
  }
  if (query.data.length === 0) {
    return (
      <View style={styles.center} testID={'empty'}>
        <Text style={styles.emptyTitle}>Không có lệnh điều xe</Text>
        <Text style={styles.muted}>Hiện chưa có lệnh nào được phân công.</Text>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <FlatList
        data={query.data}
        keyExtractor={(item) => item.roadRunId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const badgeColor = STATE_COLOR[item.state.toLowerCase()] ?? colors.slate500;
          // This card is transitioning when the in-flight mutation targets it.
          return (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.rowTitle}>{item.orderRef ?? item.roadRunId.slice(0, 8)}</Text>
                <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                  <Text style={styles.badgeText}>{roadRunStateLabelVi(item.state)}</Text>
                </View>
              </View>
              {item.customerName ? <Text style={styles.detail}>Khách hàng: {item.customerName}</Text> : null}
              {item.plate ? <Text style={styles.detail}>Số xe: {item.plate}</Text> : null}
              {/* Each stop is a capture (proof) button: tapping opens the
                  per-warehouse manifest-photo screen for that exact stop. A
                  delivery whose pickups are incomplete renders LOCKED with a
                  guidance caption (prevention); tapping it anyway shows the
                  educational Alert (fallback). */}
              {(() => {
                const stops = presentAssignmentStops(item.stops);
                return stops.map((st) => {
                const captureLabel =
                  st.stopKind === 'loading'
                    ? 'Chụp ảnh phiếu nhận hàng - ' + st.label
                    : 'Chụp ảnh phiếu giao hàng - ' + st.label;
                // Render-time lock: is this stop's capture currently gated?
                const lock = describeCaptureLock(item.stops, st.sequence);
                return (
                  <Pressable
                    key={st.key}
                    onPress={() => {
                      // Route the tap through the shared delivery-capture gate.
                      // The decision sources 'remaining' from hasManifest and
                      // blocks a premature delivery capture with a VN Alert.
                      const decision = decideCapturePress(item.stops, st.sequence);
                      if (decision.action === 'block') {
                        Alert.alert(decision.alertTitle, decision.alertMessage);
                        return;
                      }
                      router.push(
                        captureHrefForStop(item.transportOrderId, {
                          sequence: st.sequence,
                          stopKind: st.stopKind,
                          stopIndex: st.stopIndex,
                          roadRunId: item.roadRunId,
                          runState: item.state,
                          remaining: decision.remainingWithoutProof,
                        }) as Href,
                      );
                    }}
                    accessibilityRole={'button'}
                    accessibilityLabel={captureLabel}
                    accessibilityState={{ disabled: lock.locked }}
                    style={({ pressed }) => [
                      styles.stopButton,
                      lock.locked && styles.stopButtonLocked,
                      pressed && styles.stopButtonPressed,
                    ]}
                  >
                    <Text style={styles.stopButtonText}>
                      {st.label}: {st.warehouseName}{st.done ? ' ✓' : ''}{lock.locked ? ' 🔒' : ''}
                    </Text>
                    <Text style={lock.locked ? styles.stopButtonLockHint : styles.stopButtonHint}>
                      {lock.locked
                        ? lock.hint
                        : st.stopKind === 'loading' ? 'Chụp ảnh phiếu nhận hàng' : 'Chụp ảnh phiếu giao hàng'}
                    </Text>
                  </Pressable>
                );
              });
              })()}
              {item.plannedStartAt ? (
                <Text style={styles.detail}>Khởi hành: {formatVnDateUS(item.plannedStartAt)}</Text>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backdrop },
  listContent: { padding: spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backdrop,
  },
  muted: { ...typography.caption, color: colors.slate300, marginTop: spacing.sm, textAlign: 'center' },
  errorTitle: { ...typography.heading, color: colors.red600 },
  emptyTitle: { ...typography.heading, color: colors.white },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  rowTitle: { ...typography.heading, color: colors.slate900 },
  badge: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  detail: { ...typography.caption, color: colors.slate600, marginTop: 2 },
  stopButton: {
    backgroundColor: colors.slate100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  // Locked delivery capture: dimmed + amber-bordered so it reads as
  // not-yet-available rather than broken. The caption explains why.
  stopButtonLocked: {
    backgroundColor: colors.amber50,
    borderColor: colors.amber500,
    opacity: 0.85,
  },
  stopButtonPressed: { backgroundColor: colors.slate200 },
  stopButtonText: { ...typography.caption, color: colors.slate900, fontWeight: '600' },
  stopButtonHint: { ...typography.caption, color: colors.indigo600, marginTop: 2 },
  // Guidance caption under a locked button (amber to match the locked state).
  stopButtonLockHint: { ...typography.caption, color: colors.amber700, marginTop: 2, fontWeight: '600' },
  actionBtn: {
    backgroundColor: colors.indigo600,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  actionBtnPressed: { backgroundColor: colors.indigo700 },
  actionBtnDisabled: { opacity: 0.6 },
  captureBtn: {
    backgroundColor: colors.green600,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  actionText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  doneRow: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.slate100,
  },
  doneText: { color: colors.green600, fontSize: 14, fontWeight: '600' },
});

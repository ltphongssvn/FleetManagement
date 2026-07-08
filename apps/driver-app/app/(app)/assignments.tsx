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
// Server state — the list and the lifecycle transitions — is owned by the
// useAssignments TanStack Query hook: useQuery for the list, useMutation for
// accept/start/complete with automatic list invalidation on success. This
// screen no longer runs its own useEffect/useState fetch or manual refetch.
import type { JSX } from 'react';
import { useRouter, type Href } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { useAssignments } from '../../src/assignments/use-assignments.js';
import { presentAssignmentStops } from '../../src/assignments/assignment-stops-presenter.js';
import { roadRunStateLabelVi } from '../../src/assignments/road-run-state-label.js';
import { captureHrefForStop } from '../../src/assignments/capture-href.js';
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
                  per-warehouse manifest-photo screen for that exact stop. */}
              {(() => {
                const stops = presentAssignmentStops(item.stops);
                // driver-min-interaction: photos still to capture BEFORE the one
                // the driver is about to take; rides the href so capture can
                // auto-advance the lifecycle (photo-implies-progress).
                const remaining = stops.filter((s) => !s.done).length;
                return stops.map((st) => {
                const captureLabel =
                  st.stopKind === 'loading'
                    ? 'Chụp ảnh phiếu nhận hàng - ' + st.label
                    : 'Chụp ảnh phiếu giao hàng - ' + st.label;
                return (
                  <Pressable
                    key={st.key}
                    onPress={() => {
                      router.push(
                        captureHrefForStop(item.transportOrderId, {
                          sequence: st.sequence,
                          stopKind: st.stopKind,
                          stopIndex: st.stopIndex,
                          roadRunId: item.roadRunId,
                          runState: item.state,
                          remaining,
                        }) as Href,
                      );
                    }}
                    accessibilityRole={'button'}
                    accessibilityLabel={captureLabel}
                    style={({ pressed }) => [styles.stopButton, pressed && styles.stopButtonPressed]}
                  >
                    <Text style={styles.stopButtonText}>
                      {st.label}: {st.warehouseName}{st.done ? ' ✓' : ''}
                    </Text>
                    <Text style={styles.stopButtonHint}>
                      {st.stopKind === 'loading' ? 'Chụp ảnh phiếu nhận hàng' : 'Chụp ảnh phiếu giao hàng'}
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
  stopButtonPressed: { backgroundColor: colors.slate200 },
  stopButtonText: { ...typography.caption, color: colors.slate900, fontWeight: '600' },
  stopButtonHint: { ...typography.caption, color: colors.indigo600, marginTop: 2 },
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

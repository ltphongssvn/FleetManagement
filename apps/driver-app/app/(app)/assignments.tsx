// apps/driver-app/app/(app)/assignments.tsx
// Driver assignments list. Each card shows the order plus ONE context-aware
// action button (Nhận lệnh / Bắt đầu chuyến / Hoàn thành) driven by the
// road_run state. Tapping it calls the delivery-lifecycle endpoint; on
// success the list refetches so the card reflects the new state. The state
// change is also what the dispatcher's board reads, so accepting an order
// is the driver's acknowledgement back to dispatch.
//
// Server state — the list and the lifecycle transitions — is owned by the
// useAssignments TanStack Query hook: useQuery for the list, useMutation for
// accept/start/complete with automatic list invalidation on success. This
// screen no longer runs its own useEffect/useState fetch or manual refetch.
import type { JSX } from 'react';
import { useRouter, type Href } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { nextDriverAction } from '../../src/assignments/assignment-action-policy.js';
import { useAssignments } from '../../src/assignments/use-assignments.js';
import { presentAssignmentStops } from '../../src/assignments/assignment-stops-presenter.js';
import { formatVnDateTime } from '../../src/config/vn-locale.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
// Road-run state -> badge colour. Unknown states fall back to slate.
const STATE_COLOR: Record<string, string> = {
  planned: colors.slate500,
  dispatched: colors.indigo600,
  started: colors.amber500,
  completed: colors.green600,
};
export default function Assignments(): JSX.Element {
  const { query, lifecycle } = useAssignments();
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
          {query.error instanceof Error ? query.error.message : 'Lỗi tải dữ liệu'}
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
  // A lifecycle transition that failed surfaces as a banner above the list.
  const actionError: string | null =
    lifecycle.isError && lifecycle.error instanceof Error
      ? lifecycle.error.message
      : lifecycle.isError
        ? 'Lỗi cập nhật trạng thái'
        : null;
  return (
    <View style={styles.screen}>
      {actionError !== null ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{actionError}</Text>
        </View>
      ) : null}
      <FlatList
        data={query.data}
        keyExtractor={(item) => item.roadRunId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const badgeColor = STATE_COLOR[item.state.toLowerCase()] ?? colors.slate500;
          const action = nextDriverAction(item.state);
          // Narrow once: actionKind is the non-terminal kind or null.
          const actionKind: 'accept' | 'start' | 'complete' | null =
            action.kind === 'none' ? null : action.kind;
          // This card is transitioning when the in-flight mutation targets it.
          const isPending =
            lifecycle.isPending && lifecycle.variables.roadRunId === item.roadRunId;
          return (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.rowTitle}>{item.orderRef ?? item.roadRunId.slice(0, 8)}</Text>
                <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                  <Text style={styles.badgeText}>{item.state}</Text>
                </View>
              </View>
              {item.customerName ? <Text style={styles.detail}>Khách hàng: {item.customerName}</Text> : null}
              {item.plate ? <Text style={styles.detail}>Số xe: {item.plate}</Text> : null}
              {presentAssignmentStops(item.stops).map((st) => (
                <Text key={st.key} style={styles.detail}>
                  {st.label}: {st.warehouseName}{st.done ? ' ✓' : ''}
                </Text>
              ))}
              {item.plannedStartAt ? (
                <Text style={styles.detail}>Khởi hành: {formatVnDateTime(item.plannedStartAt)}</Text>
              ) : null}
              {actionKind === null ? (
                <Pressable
                  onPress={() => {
                    router.push(('/capture?transportOrderId=' + item.transportOrderId) as Href);
                  }}
                  accessibilityRole={'button'}
                  accessibilityLabel={'Chụp ảnh giao hàng'}
                  style={({ pressed }) => [styles.captureBtn, pressed && styles.actionBtnPressed]}
                >
                  <Text style={styles.actionText}>Chụp ảnh giao hàng</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => { lifecycle.mutate({ roadRunId: item.roadRunId, kind: actionKind }); }}
                  disabled={isPending}
                  accessibilityRole={'button'}
                  accessibilityLabel={action.label}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.actionBtnPressed,
                    isPending && styles.actionBtnDisabled,
                  ]}
                >
                  {isPending ? (
                    <ActivityIndicator size={'small'} color={colors.white} />
                  ) : (
                    <Text style={styles.actionText}>{action.label}</Text>
                  )}
                </Pressable>
              )}
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
  errorBanner: {
    backgroundColor: colors.red50,
    borderBottomWidth: 1,
    borderBottomColor: colors.red200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorBannerText: { color: colors.red700, fontSize: 13, textAlign: 'center' },
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

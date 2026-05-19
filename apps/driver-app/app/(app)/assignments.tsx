// apps/driver-app/app/(app)/assignments.tsx
// Driver assignments list. Each card shows the order plus ONE context-aware
// action button (Nhận lệnh / Bắt đầu chuyến / Hoàn thành) driven by the
// road_run state. Tapping it calls the delivery-lifecycle endpoint; on
// success the list refetches so the card reflects the new state. The state
// change is also what the dispatcher's board reads, so accepting an order
// is the driver's acknowledgement back to dispatch.
import type { JSX } from 'react';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { AssignmentsClient } from '../../src/assignments/assignments-client.js';
import { fetchAssignmentsState, type AssignmentsState } from '../../src/assignments/assignments-state.js';
import { DeliveryLifecycleClient } from '../../src/assignments/delivery-lifecycle-client.js';
import { nextDriverAction } from '../../src/assignments/assignment-action-policy.js';
import { useAuth } from '../../src/auth/use-auth.js';
import { formatVnDateTime } from '../../src/config/vn-locale.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
import { getApiUrl } from '../../src/config/api-url.js';
// Road-run state -> badge colour. Unknown states fall back to slate.
const STATE_COLOR: Record<string, string> = {
  planned: colors.slate500,
  dispatched: colors.indigo600,
  started: colors.amber500,
  completed: colors.green600,
};
export default function Assignments(): JSX.Element {
  const [state, setState] = useState<AssignmentsState>({ kind: 'loading' });
  // roadRunId currently being transitioned (button shows a spinner, is locked).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { getAccessToken, status } = useAuth();
  const router = useRouter();
  const load = useCallback((): void => {
    const client = new AssignmentsClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken });
    void fetchAssignmentsState(client).then(setState);
  }, [getAccessToken]);
  useEffect(() => {
    if (status !== 'authenticated') return;
    load();
  }, [status, load]);
  const runAction = useCallback(
    async (roadRunId: string, kind: 'accept' | 'start' | 'complete'): Promise<void> => {
      setActionError(null);
      setPendingId(roadRunId);
      try {
        const client = new DeliveryLifecycleClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken });
        if (kind === 'accept') await client.accept(roadRunId);
        else if (kind === 'start') await client.start(roadRunId);
        else await client.complete(roadRunId);
        // Refetch so the card reflects the new state (and its next action).
        load();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Lỗi cập nhật trạng thái');
      } finally {
        setPendingId(null);
      }
    },
    [getAccessToken, load],
  );
  if (state.kind === 'loading') {
    return (
      <View style={styles.center} testID={'loading'}>
        <ActivityIndicator size={'large'} color={colors.indigo500} />
        <Text style={styles.muted}>Đang tải lệnh điều xe…</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.center} testID={'error'}>
        <Text style={styles.errorTitle}>Lỗi tải dữ liệu</Text>
        <Text style={styles.muted}>{state.message}</Text>
      </View>
    );
  }
  if (state.kind === 'empty') {
    return (
      <View style={styles.center} testID={'empty'}>
        <Text style={styles.emptyTitle}>Không có lệnh điều xe</Text>
        <Text style={styles.muted}>Hiện chưa có lệnh nào được phân công.</Text>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      {actionError !== null ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{actionError}</Text>
        </View>
      ) : null}
      <FlatList
        data={state.rows}
        keyExtractor={(item) => item.roadRunId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const badgeColor = STATE_COLOR[item.state.toLowerCase()] ?? colors.slate500;
          const action = nextDriverAction(item.state);
          // Narrow once: actionKind is the non-terminal kind or null.
          const actionKind: 'accept' | 'start' | 'complete' | null =
            action.kind === 'none' ? null : action.kind;
          const isPending = pendingId === item.roadRunId;
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
              {item.pickupName ? <Text style={styles.detail}>Kho nhận: {item.pickupName}</Text> : null}
              {item.deliveryName ? <Text style={styles.detail}>Kho giao: {item.deliveryName}</Text> : null}
              {item.plannedStartAt ? (
                <Text style={styles.detail}>Khởi hành: {formatVnDateTime(item.plannedStartAt)}</Text>
              ) : null}
              {actionKind === null ? (
                <Pressable
                  onPress={() => {
                    router.push(`/capture?transportOrderId=${item.transportOrderId}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Chụp ảnh giao hàng"
                  style={({ pressed }) => [styles.captureBtn, pressed && styles.actionBtnPressed]}
                >
                  <Text style={styles.actionText}>Chụp ảnh giao hàng</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => { void runAction(item.roadRunId, actionKind); }}
                  disabled={isPending}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.actionBtnPressed,
                    isPending && styles.actionBtnDisabled,
                  ]}
                >
                  {isPending ? (
                    <ActivityIndicator size="small" color={colors.white} />
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

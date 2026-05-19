// apps/driver-app/app/(app)/history.tsx
// Driver trip-history screen. Calls GET /transport-orders/trip-history, which
// returns the driver's completed runs already grouped by VN-timezone month
// (the API groups via the shared @fleet/domain helper, so web and mobile
// agree on month boundaries). Read-only: no lifecycle actions here.
//
// Separation of concerns: this file only fetches and renders. Grouping is
// owned by the backend; the screen maps the month list straight onto a
// SectionList, which virtualizes every trip row so a driver with hundreds of
// completed trips in one month does not force every row into memory at once.
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SectionList, Text, View, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { AssignmentsClient, type AssignmentRow, type TripHistoryMonth } from '../../src/assignments/assignments-client.js';
import { getApiUrl } from '../../src/config/api-url.js';
import { useAuth } from '../../src/auth/use-auth.js';
import { formatVnDate } from '../../src/config/vn-locale.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
interface MonthSection {
  readonly key: string;
  readonly title: string;
  readonly count: number;
  readonly data: readonly AssignmentRow[];
}
type ScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; sections: readonly MonthSection[] };
function toSections(months: readonly TripHistoryMonth[]): readonly MonthSection[] {
  return months.map((m) => ({ key: m.monthKey, title: m.label, count: m.count, data: m.trips }));
}
export default function History(): JSX.Element {
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const { getAccessToken, status } = useAuth();
  const load = useCallback((): (() => void) => {
    // Unmount guard: if the screen unmounts before the fetch resolves, skip
    // the setState so React does not warn about updating an unmounted tree.
    let cancelled = false;
    const client = new AssignmentsClient({ apiUrl: getApiUrl(), bearerToken: getAccessToken });
    void client.tripHistory()
      .then((months) => {
        if (cancelled) return;
        setState({ kind: 'loaded', sections: toSections(months) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Production telemetry: surface fetch failures to Sentry (token
        // scrubbing is handled by the shared sentry-bootstrap beforeSend),
        // matching the commands screen rather than silently swallowing.
        Sentry.captureException(e);
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi tải dữ liệu' });
      });
    return (): void => { cancelled = true; };
  }, [getAccessToken]);
  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    return load();
  }, [status, load]);
  if (state.kind === 'loading') {
    return (
      <View style={styles.center} testID='loading'>
        <ActivityIndicator size='large' color={colors.indigo500} />
        <Text style={styles.muted}>Đang tải lịch sử chuyến…</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.center} testID='error'>
        <Text style={styles.errorTitle}>Lỗi tải dữ liệu</Text>
        <Text style={styles.muted}>{state.message}</Text>
      </View>
    );
  }
  if (state.sections.length === 0) {
    return (
      <View style={styles.center} testID='empty'>
        <Text style={styles.emptyTitle}>Chưa có chuyến hoàn thành</Text>
        <Text style={styles.muted}>Các chuyến đã giao xong sẽ hiển thị ở đây theo từng tháng.</Text>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <SectionList
        sections={state.sections as MonthSection[]}
        keyExtractor={(item) => item.roadRunId}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => {
          const s = section as MonthSection;
          return (
            <View
              style={styles.monthHeader}
              accessibilityRole='header'
              accessibilityLabel={s.title + ': ' + String(s.count) + ' chuyến'}
            >
              <Text style={styles.monthLabel}>{s.title}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{s.count} chuyến</Text>
              </View>
            </View>
          );
        }}
        renderItem={({ item }) => (
          <View
            style={styles.tripRow}
            accessibilityRole='text'
            accessibilityLabel={'Chuyến ' + (item.orderRef ?? item.roadRunId.slice(0, 8))}
          >
            <Text style={styles.tripRef}>{item.orderRef ?? item.roadRunId.slice(0, 8)}</Text>
            <View style={styles.tripMeta}>
              {item.customerName ? <Text style={styles.tripDetail}>Khách hàng: {item.customerName}</Text> : null}
              {item.deliveryName ? <Text style={styles.tripDetail}>Kho giao: {item.deliveryName}</Text> : null}
              {item.completedAt ? (
                <Text style={styles.tripDetail}>Hoàn thành: {formatVnDate(item.completedAt)}</Text>
              ) : null}
            </View>
          </View>
        )}
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
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  monthLabel: { ...typography.heading, color: colors.white },
  countBadge: {
    backgroundColor: colors.indigo600,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  tripRow: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  tripRef: { ...typography.heading, color: colors.slate900 },
  tripMeta: { marginTop: 2 },
  tripDetail: { ...typography.caption, color: colors.slate600, marginTop: 2 },
});

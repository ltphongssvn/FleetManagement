// apps/driver-app/app/(app)/completed.tsx
// Driver completed-orders screen: the paginated + searchable archive of the
// driver's finished transport orders (the ops-web 'Lệnh điều xe' completed
// partition, mobile edition). Non-complete orders live on the assignments
// screen ('Xem Lệnh Điều Xe'); this screen shows ONLY completed runs.
//
// Data comes from the useCompletedOrders useInfiniteQuery hook. Pages are
// flattened into one list; FlatList.onEndReached pulls the next page while
// hasNextPage is true (infinite scroll). A search box filters by order ref /
// customer name server-side: typing debounces then re-keys the query, starting
// a fresh paginated fetch. Read-only: no lifecycle actions here.
import { useState, useEffect, type JSX } from 'react';
import { ActivityIndicator, FlatList, TextInput, Text, View, StyleSheet } from 'react-native';
import type { ListAssignedRow } from '@fleet/sync-protocol';
import { useCompletedOrders } from '../../src/assignments/use-completed-orders.js';
import { formatVnDate } from '../../src/config/vn-locale.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';

export default function Completed(): JSX.Element {
  // Raw text box value + the debounced term actually driving the query. Empty
  // string means no filter (passed as undefined so the query key is stable).
  const [text, setText] = useState('');
  const [term, setTerm] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = text.trim();
      setTerm(trimmed.length === 0 ? undefined : trimmed);
    }, 300);
    return () => { clearTimeout(t); };
  }, [text]);

  const query = useCompletedOrders(term);

  // Flatten every fetched page into one row list for the FlatList.
  const rows: readonly ListAssignedRow[] =
    query.data?.pages.flatMap((p) => p.data) ?? [];

  const searchBox = (
    <View style={styles.searchWrap}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={'Tìm theo số lệnh hoặc khách hàng'}
        placeholderTextColor={colors.slate300}
        style={styles.searchInput}
        accessibilityLabel={'Tìm lệnh đã hoàn thành'}
        autoCorrect={false}
      />
    </View>
  );

  if (query.isPending) {
    return (
      <View style={styles.screen}>
        {searchBox}
        <View style={styles.center} testID={'loading'}>
          <ActivityIndicator size={'large'} color={colors.indigo500} />
          <Text style={styles.muted}>Đang tải lệnh đã hoàn thành…</Text>
        </View>
      </View>
    );
  }
  if (query.isError) {
    return (
      <View style={styles.screen}>
        {searchBox}
        <View style={styles.center} testID={'error'}>
          <Text style={styles.errorTitle}>Lỗi tải dữ liệu</Text>
          <Text style={styles.muted}>
            {query.error instanceof Error ? query.error.message : 'Lỗi tải dữ liệu'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {searchBox}
      <FlatList
        data={rows as ListAssignedRow[]}
        keyExtractor={(item) => item.roadRunId}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          <View style={styles.center} testID={'empty'}>
            <Text style={styles.emptyTitle}>Chưa có lệnh hoàn thành</Text>
            <Text style={styles.muted}>
              {term === undefined
                ? 'Các lệnh đã giao xong sẽ hiển thị ở đây.'
                : 'Không tìm thấy lệnh phù hợp.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={styles.footer} testID={'loading-more'}>
              <ActivityIndicator size={'small'} color={colors.indigo500} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View
            style={styles.tripRow}
            accessibilityRole={'text'}
            accessibilityLabel={'Lệnh ' + (item.orderRef ?? item.roadRunId.slice(0, 8))}
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
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.backdrop,
  },
  searchInput: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.slate900,
    fontSize: 15,
  },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
  muted: { ...typography.caption, color: colors.slate300, marginTop: spacing.sm, textAlign: 'center' },
  errorTitle: { ...typography.heading, color: colors.red600 },
  emptyTitle: { ...typography.heading, color: colors.white },
  tripRow: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.slate200,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    ...shadow.card,
  },
  tripRef: { ...typography.heading, color: colors.slate900 },
  tripMeta: { marginTop: 2 },
  tripDetail: { ...typography.caption, color: colors.slate600, marginTop: 2 },
});

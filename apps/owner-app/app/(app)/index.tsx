// apps/owner-app/app/(app)/index.tsx
// Owner glance dashboard. One screen: a big installed/total headline with an
// adoption percentage, the funnel rows below, pull-to-refresh, and clear
// loading/error states. Consumes the unit-tested presenter + fetch client via
// the useAdoption react-query hook. Vietnamese UI throughout.
import type { JSX } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useAdoption } from '../../src/dashboard/use-adoption.js';
import { presentAdoption } from '../../src/dashboard/adoption-presenter.js';
import { colors, spacing, radius, fontSize } from '../../src/theme/tokens.js';

export default function DashboardScreen(): JSX.Element {
  const query = useAdoption();

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backdrop }}>
        <ActivityIndicator size="large" color={colors.indigo500} />
      </View>
    );
  }

  if (query.isError || query.data === undefined) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.backdrop }}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} tintColor={colors.white} />}
      >
        <Text style={{ color: colors.red200, fontSize: fontSize.lg, textAlign: 'center', marginBottom: spacing.md }}>
          Không tải được số liệu
        </Text>
        <Text style={{ color: colors.slate400, fontSize: fontSize.sm, textAlign: 'center' }}>
          Kéo xuống để thử lại
        </Text>
      </ScrollView>
    );
  }

  const vm = presentAdoption(query.data);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.backdrop }}
      contentContainerStyle={{ padding: spacing.xl }}
      refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} tintColor={colors.white} />}
    >
      <View style={{ alignItems: 'center', marginBottom: spacing.xxl }}>
        <Text style={{ color: colors.slate400, fontSize: fontSize.base, marginBottom: spacing.sm }}>
          Đã cài đặt ứng dụng
        </Text>
        <Text style={{ color: colors.white, fontSize: fontSize.huge, fontWeight: '800', lineHeight: fontSize.huge + 4 }}>
          {String(vm.appInstalled)}
          <Text style={{ color: colors.slate500, fontSize: fontSize.xl, fontWeight: '600' }}>{' / ' + String(vm.totalDrivers)}</Text>
        </Text>
        <View style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.xl, backgroundColor: colors.indigo600 }}>
          <Text style={{ color: colors.white, fontSize: fontSize.lg, fontWeight: '700' }}>{String(vm.installedPct) + '%'}</Text>
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        {vm.rows.map((r) => (
          <View
            key={r.key}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.slate900, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}
          >
            <Text style={{ color: colors.slate300, fontSize: fontSize.base }}>{r.label}</Text>
            <Text style={{ color: colors.white, fontSize: fontSize.xl, fontWeight: '700' }}>{String(r.value)}</Text>
          </View>
        ))}
      </View>

      <Text style={{ color: colors.slate600, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.xl }}>
        {'Ngày ' + vm.day}
      </Text>
    </ScrollView>
  );
}

// apps/driver-app/app/(app)/index.tsx
// Driver home — sync status + primary actions. Logout lives in the global
// header (see (app)/_layout.tsx), so it is reachable from every screen and
// is intentionally not duplicated here.
import type { JSX } from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { APP_VERSION, presentSyncStatus, type SyncSchedulerState } from '../../src/index.js';
import { colors, spacing, radius, typography, shadow } from '../../src/theme/tokens.js';
const PLACEHOLDER_STATE: SyncSchedulerState = {
  online: true,
  appActive: true,
  lastSyncAtMs: null,
  lastOutcome: null,
  consecutiveTransportFailures: 0,
};
interface ActionDef {
  readonly label: string;
  readonly href: string;
}
const ACTIONS: readonly ActionDef[] = [
  { label: 'Xem lệnh điều xe', href: '/assignments' },
  { label: 'Lịch sử chuyến (theo tháng)', href: '/history' },
  { label: 'Lệnh điều phối (trực tiếp)', href: '/commands' },
  { label: 'Chụp ảnh phiếu giao hàng', href: '/capture' },
];
export default function Home(): JSX.Element {
  const view = presentSyncStatus(PLACEHOLDER_STATE, Date.now());
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.headerTitle}>Trạng thái đồng bộ</Text>
          <Text style={styles.headerSub}>{view.label} · {view.secondary}</Text>
        </View>
        <View style={styles.cardBody}>
          {ACTIONS.map((a) => (
            <Pressable
              key={a.href}
              onPress={() => { router.push(a.href as Href); }}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            >
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={styles.version}>Fleet Driver v{APP_VERSION}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backdrop,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.slate200,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardHeader: {
    backgroundColor: colors.indigo50,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  headerTitle: { ...typography.title, color: colors.slate900 },
  headerSub: { ...typography.caption, color: colors.slate500, marginTop: spacing.xs },
  cardBody: { paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  actionBtn: {
    backgroundColor: colors.indigo600,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  actionBtnPressed: { backgroundColor: colors.indigo700 },
  actionText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  version: { ...typography.caption, color: colors.slate500, marginTop: spacing.lg },
});

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { fetchGateSnapshot, triggerGateSync } from '@/api/gate';
import { colors, fontSize, isTabletWidth, spacing } from '@/theme';

export function GateSyncScreen() {
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);
  const qc = useQueryClient();

  const snapshotQuery = useQuery({
    queryKey: ['gate-snapshot'],
    queryFn: fetchGateSnapshot,
    refetchInterval: 10_000,
  });

  const syncMutation = useMutation({
    mutationFn: triggerGateSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gate-snapshot'] });
      Alert.alert('Sync triggered', 'Gate sync has been requested.');
    },
    onError: (e: Error) => Alert.alert('Sync failed', e.message),
  });

  if (snapshotQuery.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const snap = snapshotQuery.data ?? {};
  const online = snap.online ?? false;
  const error = snapshotQuery.error as Error | null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scroll, tablet && styles.scrollTablet]}>
        <Card>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Gate controller</Text>
            <StatusBadge
              label={online ? 'Online' : 'Offline'}
              tone={online ? 'success' : 'danger'}
            />
          </View>
          {snap.last_sync && (
            <Text style={styles.muted}>Last sync: {snap.last_sync}</Text>
          )}
          {typeof snap.members_total === 'number' && (
            <Text style={styles.muted}>Members synced: {snap.members_total}</Text>
          )}
          {typeof snap.credentials_total === 'number' && (
            <Text style={styles.muted}>
              Credentials synced: {snap.credentials_total}
            </Text>
          )}
          {typeof snap.pending_changes === 'number' && (
            <Text style={styles.muted}>
              Pending changes: {snap.pending_changes}
            </Text>
          )}
          {error && (
            <Text style={styles.error}>{error.message}</Text>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.section}>Manual resync</Text>
          <Text style={styles.muted}>
            Force the gate controller to pull the latest member and credential
            data from the server.
          </Text>
          <Button
            title="Sync gate now"
            onPress={() => syncMutation.mutate()}
            loading={syncMutation.isPending}
            fullWidth
            style={{ marginTop: spacing.md }}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg },
  scrollTablet: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  section: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  error: { color: colors.danger, marginTop: spacing.sm, fontSize: fontSize.sm },
});

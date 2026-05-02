import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { fetchGateHistory, GateHistoryEntry } from '@/api/gate';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { ApiError } from '@/api/client';
import { colors, fontSize, isTabletWidth, spacing } from '@/theme';

export function HistoryScreen() {
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);

  const query = useQuery({
    queryKey: ['gate-history'],
    queryFn: () => fetchGateHistory(50),
    refetchInterval: 30_000,
  });

  if (query.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (query.error) {
    const status = (query.error as ApiError).status;
    const msg =
      status === 404 || status === 501
        ? 'History endpoint is not deployed yet on the backend.'
        : (query.error as Error).message || 'Could not load history.';
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>{msg}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList<GateHistoryEntry>
        data={query.data ?? []}
        keyExtractor={(e) => e.id}
        contentContainerStyle={[styles.list, tablet && styles.listTablet]}
        renderItem={({ item }) => (
          <Card style={styles.entry}>
            <View style={styles.row}>
              <Text style={styles.name}>{item.person_name}</Text>
              <StatusBadge
                label={item.status === 'allowed' ? 'Allowed' : 'Denied'}
                tone={item.status === 'allowed' ? 'success' : 'danger'}
              />
            </View>
            {item.reason && <Text style={styles.reason}>{item.reason}</Text>}
            <Text style={styles.time}>{item.check_in_time}</Text>
          </Card>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No recent entries.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  list: { padding: spacing.md, gap: spacing.sm },
  listTablet: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  entry: { marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  reason: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  time: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  empty: { padding: spacing.lg, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, textAlign: 'center' },
});

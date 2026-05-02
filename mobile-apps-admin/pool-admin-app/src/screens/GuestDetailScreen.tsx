import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMemberCredentials,
  fetchPoolMembers,
  PoolCredential,
  PoolMember,
  revokeMemberCredential,
  updateMember,
} from '@/api/poolMembers';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { colors, fontSize, isTabletWidth, spacing } from '@/theme';
import { maskCredential } from '@/utils/mask';
import { getSecureItem, StorageKeys } from '@/utils/storage';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'GuestDetail'>;

function isMemberActive(m: PoolMember | undefined): boolean {
  if (!m) return false;
  if (m.is_active === false || m.is_active === 0) return false;
  const s = (m.status || '').toLowerCase();
  if (s === 'suspended' || s === 'inactive' || s === 'disabled') return false;
  return true;
}

export function GuestDetailScreen({ route }: Props) {
  const { memberId } = route.params;
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);
  const qc = useQueryClient();

  const membersQuery = useQuery({ queryKey: ['pool-members'], queryFn: fetchPoolMembers });
  const credsQuery = useQuery({
    queryKey: ['member-credentials', memberId],
    queryFn: () => fetchMemberCredentials(memberId),
  });

  const member = useMemo(
    () => membersQuery.data?.find((m) => m.id === memberId),
    [membersQuery.data, memberId],
  );

  const [unmask, setUnmask] = useState(false);
  useEffect(() => {
    (async () => {
      const v = await getSecureItem(StorageKeys.unmaskCredentials);
      setUnmask(v === '1');
    })();
  }, []);

  const updateMutation = useMutation({
    mutationFn: (active: boolean) =>
      updateMember(memberId, { is_active: active, status: active ? 'active' : 'suspended' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pool-members'] }),
    onError: (e: Error) => Alert.alert('Update failed', e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (credId: string) => revokeMemberCredential(memberId, credId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['member-credentials', memberId] }),
    onError: (e: Error) => Alert.alert('Revoke failed', e.message),
  });

  if (membersQuery.isLoading || credsQuery.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!member) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>Member not found.</Text>
      </View>
    );
  }

  const active = isMemberActive(member);
  const creds: PoolCredential[] = credsQuery.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scroll, tablet && styles.scrollTablet]}>
        <Card>
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {member.first_name} {member.last_name}
            </Text>
            <StatusBadge
              label={active ? 'Active' : 'Disabled'}
              tone={active ? 'success' : 'danger'}
            />
          </View>
          <Text style={styles.muted}>{member.entry_type_name}</Text>
          {member.household_owner_name && (
            <Text style={styles.muted}>Host: {member.household_owner_name}</Text>
          )}
          {member.street_address && (
            <Text style={styles.muted}>{member.street_address}</Text>
          )}

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Pool access enabled</Text>
            <Switch
              value={active}
              onValueChange={(v) => updateMutation.mutate(v)}
              disabled={updateMutation.isPending}
            />
          </View>
          {updateMutation.isPending && (
            <Text style={styles.muted}>Saving…</Text>
          )}
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.section}>Credentials</Text>
          {creds.length === 0 && (
            <Text style={styles.muted}>No credentials registered.</Text>
          )}
          {creds.map((c) => (
            <View key={c.id} style={styles.credRow}>
              <View style={styles.credHeader}>
                <Text style={styles.credType}>
                  {c.credential_type === 'rfid'
                    ? 'RFID card'
                    : c.device_platform === 'ios'
                    ? 'iPhone'
                    : c.device_platform === 'android'
                    ? 'Android phone'
                    : c.credential_type}
                </Text>
                <StatusBadge
                  label={c.status === 'active' ? 'Active' : c.status}
                  tone={
                    c.status === 'active'
                      ? 'success'
                      : c.status === 'pending'
                      ? 'warning'
                      : 'neutral'
                  }
                />
              </View>
              {c.device_label && (
                <Text style={styles.muted}>{c.device_label}</Text>
              )}
              <Text style={styles.credId}>
                {unmask
                  ? c.credential_value || '—'
                  : maskCredential(c.credential_value)}
              </Text>
              {c.status === 'active' && (
                <Button
                  variant="danger"
                  title="Revoke"
                  onPress={() =>
                    Alert.alert('Revoke credential?', 'This cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Revoke',
                        style: 'destructive',
                        onPress: () => revokeMutation.mutate(c.id),
                      },
                    ])
                  }
                  fullWidth
                  style={{ marginTop: spacing.sm }}
                />
              )}
            </View>
          ))}

          {!unmask && (
            <Text style={styles.maskNote}>
              Credentials are masked. Super-admins can enable unmasking in
              Settings.
            </Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  scroll: { padding: spacing.lg },
  scrollTablet: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, flex: 1, marginRight: spacing.sm },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  section: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  toggleLabel: { fontSize: fontSize.md, color: colors.text, flex: 1, marginRight: spacing.md },
  credRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  credHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  credType: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  credId: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontFamily: 'Courier',
    marginTop: spacing.xs,
  },
  maskNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  error: { color: colors.danger },
});

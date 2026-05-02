import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPoolPhones,
  PoolPhone,
  registerPoolPhone,
  revokePoolPhone,
  fetchHousehold,
} from '@/api/household';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { colors, fontSize, isTabletWidth, radius, spacing } from '@/theme';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'CredentialDetail'>;

export function CredentialDetailScreen({ route }: Props) {
  const { personType, personId, personName } = route.params;
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);
  const qc = useQueryClient();

  const householdQuery = useQuery({ queryKey: ['household'], queryFn: fetchHousehold });
  const phonesQuery = useQuery({ queryKey: ['pool-phones'], queryFn: fetchPoolPhones });

  const isUnder16 = useMemo(() => {
    if (personType !== 'child' || !personId || !householdQuery.data) return false;
    const child = householdQuery.data.children.find((c) => c.id === personId);
    return !!child && !child.is_16_plus;
  }, [householdQuery.data, personType, personId]);

  const phones = useMemo<PoolPhone[]>(() => {
    return (phonesQuery.data?.phones ?? []).filter((p) => {
      if (personType === 'self') return p.person_type === 'self';
      return p.person_type === personType && p.person_id === personId;
    });
  }, [phonesQuery.data, personType, personId]);

  const activePhone = phones.find((p) => p.status === 'active');

  const [platform, setPlatform] = useState<'ios' | 'android'>('ios');
  const [label, setLabel] = useState('');

  const registerMutation = useMutation({
    mutationFn: registerPoolPhone,
    onSuccess: () => {
      setLabel('');
      qc.invalidateQueries({ queryKey: ['pool-phones'] });
    },
    onError: (e: Error) => Alert.alert('Could not register phone', e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: revokePoolPhone,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pool-phones'] }),
    onError: (e: Error) => Alert.alert('Could not revoke phone', e.message),
  });

  if (phonesQuery.isLoading || householdQuery.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scroll, tablet && styles.scrollTablet]}>
        <Text style={styles.title}>{personName}</Text>

        {isUnder16 && (
          <Card style={styles.warnCard}>
            <Text style={styles.warnText}>
              Children under 16 cannot have an independent phone credential.
              Please use a card credential or wait until they turn 16.
            </Text>
          </Card>
        )}

        <Card>
          <Text style={styles.section}>Phone credential</Text>
          {activePhone ? (
            <View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Type</Text>
                <Text style={styles.rowValue}>
                  {activePhone.device_platform === 'ios' ? 'iPhone' : 'Android'}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Label</Text>
                <Text style={styles.rowValue}>
                  {activePhone.device_label || '—'}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Pool access</Text>
                <StatusBadge
                  label={activePhone.is_active_guest ? 'Active' : 'Inactive'}
                  tone={activePhone.is_active_guest ? 'success' : 'warning'}
                />
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Wallet pass</Text>
                <StatusBadge
                  label={activePhone.wallet_pass_status === 'sent' ? 'Sent' : 'Pending'}
                  tone={activePhone.wallet_pass_status === 'sent' ? 'success' : 'warning'}
                />
              </View>
              <Button
                variant="danger"
                title="Revoke phone"
                onPress={() =>
                  Alert.alert(
                    'Revoke phone?',
                    'This will remove the phone credential. You can register a different phone later.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Revoke',
                        style: 'destructive',
                        onPress: () => revokeMutation.mutate(activePhone.id),
                      },
                    ],
                  )
                }
                loading={revokeMutation.isPending}
                fullWidth
                style={{ marginTop: spacing.md }}
              />
            </View>
          ) : (
            <Text style={styles.muted}>No phone registered yet.</Text>
          )}
        </Card>

        {!isUnder16 && (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={styles.section}>
              {activePhone ? 'Replace phone' : 'Register phone'}
            </Text>

            <Text style={styles.label}>Phone type</Text>
            <View style={styles.toggleRow}>
              <Button
                title="iPhone"
                variant={platform === 'ios' ? 'primary' : 'secondary'}
                onPress={() => setPlatform('ios')}
                style={styles.toggleBtn}
              />
              <Button
                title="Android"
                variant={platform === 'android' ? 'primary' : 'secondary'}
                onPress={() => setPlatform('android')}
                style={styles.toggleBtn}
              />
            </View>

            <Text style={styles.label}>Label (optional)</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g., Personal iPhone 16"
            />

            <Button
              title={activePhone ? 'Replace phone' : 'Register phone'}
              onPress={() =>
                registerMutation.mutate({
                  person_type: personType,
                  person_id: personType === 'self' ? null : personId,
                  device_platform: platform,
                  device_label: label.trim() || undefined,
                })
              }
              loading={registerMutation.isPending}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.section}>Card credential</Text>
          <Text style={styles.muted}>
            Card assignment is managed by the HOA admin. Contact admin to
            request a new card or update an existing card.
          </Text>
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
  title: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  section: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  rowLabel: { color: colors.textMuted, fontSize: fontSize.sm },
  rowValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  label: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggleBtn: { flex: 1 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  warnCard: { backgroundColor: '#fcf2d6', borderColor: '#e6c875', marginBottom: spacing.md },
  warnText: { color: colors.warning, fontSize: fontSize.sm, fontWeight: '600' },
});

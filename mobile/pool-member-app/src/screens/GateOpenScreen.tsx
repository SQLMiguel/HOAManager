import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { OfflineBanner } from '@/components/OfflineBanner';
import { StatusBadge, StatusTone } from '@/components/StatusBadge';
import { colors, fontSize, isTabletWidth, spacing } from '@/theme';
import { openGate, GateOpenResponse } from '@/api/gate';
import { checkPoolGeofence } from '@/utils/geofence';
import { ApiError } from '@/api/client';
import { getSecureItem, StorageKeys } from '@/utils/storage';

type ResultState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; data: GateOpenResponse }
  | { kind: 'error'; message: string };

export function GateOpenScreen() {
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });

  async function onPress() {
    setResult({ kind: 'pending' });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const biometricsEnabled = (await getSecureItem(StorageKeys.biometricsEnabled)) === '1';
      if (biometricsEnabled) {
        const ok = await runBiometric();
        if (!ok) {
          setResult({ kind: 'error', message: 'Biometric verification failed.' });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
      }

      const fence = await checkPoolGeofence();
      if (!fence.ok) {
        setResult({
          kind: 'error',
          message:
            fence.reason === 'permission_denied'
              ? 'Location permission is required to verify you are at the pool.'
              : `You are too far from the pool gate${
                  fence.distanceMeters ? ` (${fence.distanceMeters} m away)` : ''
                }.`,
        });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      const data = await openGate({});
      setResult({ kind: 'success', data });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const err = e as ApiError | Error;
      const status = (err as ApiError).status;
      let message = err.message || 'Could not open gate.';
      if (status === 404 || status === 501) {
        message =
          'Mobile gate-open endpoint is not deployed yet on the backend. See docs/mobile-apps.';
      } else if (status === 401) {
        message = 'Your session expired. Please sign in again.';
      } else if (status === 429) {
        message = 'Too many attempts. Wait a moment and try again.';
      }
      setResult({ kind: 'error', message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={[styles.scroll, tablet && styles.scrollTablet]}>
        <View style={styles.center}>
          <Pressable
            onPress={onPress}
            disabled={result.kind === 'pending'}
            style={({ pressed }) => [
              styles.bigButton,
              tablet && styles.bigButtonTablet,
              pressed && styles.bigButtonPressed,
              result.kind === 'pending' && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open the pool gate"
          >
            <Text style={styles.bigButtonText}>
              {result.kind === 'pending' ? 'Opening…' : 'Open Gate'}
            </Text>
          </Pressable>
          <Text style={styles.helper}>
            Tap once when you are at the pool gate.
          </Text>
        </View>

        {result.kind === 'success' && (
          <Card style={styles.resultCard}>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Result</Text>
              <StatusBadge
                label={result.data.allowed ? 'Allowed' : 'Denied'}
                tone={(result.data.allowed ? 'success' : 'danger') as StatusTone}
              />
            </View>
            {result.data.member_name && (
              <Text style={styles.resultDetail}>For: {result.data.member_name}</Text>
            )}
            {result.data.reason && (
              <Text style={styles.resultDetail}>Reason: {result.data.reason}</Text>
            )}
            {result.data.timestamp && (
              <Text style={styles.resultDetail}>Time: {result.data.timestamp}</Text>
            )}
            <Button
              title="Open again"
              variant="secondary"
              onPress={() => setResult({ kind: 'idle' })}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}

        {result.kind === 'error' && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>Could not open gate</Text>
            <Text style={styles.errorBody}>{result.message}</Text>
            <Button
              title="Try again"
              onPress={onPress}
              fullWidth
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

async function runBiometric(): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync();
  if (!has) return true;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return true;
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirm pool gate access',
    cancelLabel: 'Cancel',
  });
  return res.success;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, flexGrow: 1 },
  scrollTablet: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  center: { alignItems: 'center', marginVertical: spacing.xl },
  bigButton: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
  },
  bigButtonTablet: { width: 320, height: 320, borderRadius: 160 },
  bigButtonPressed: { backgroundColor: colors.primaryDark },
  bigButtonText: { color: '#fff', fontSize: fontSize.xl, fontWeight: '800' },
  helper: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.md },
  resultCard: { marginTop: spacing.lg },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  resultLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  resultDetail: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  errorCard: {
    marginTop: spacing.lg,
    backgroundColor: '#fbe4e0',
    borderColor: '#e8a39a',
  },
  errorTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.danger },
  errorBody: { fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.xs },
});

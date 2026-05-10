import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useAuth } from '@/auth/AuthContext';
import {
  getSecureItem,
  setSecureItem,
  StorageKeys,
} from '@/utils/storage';
import { getApiBaseUrl } from '@/api/client';
import { colors, fontSize, isTabletWidth, radius, spacing } from '@/theme';

export function SettingsScreen() {
  const { signOut, setServerUrl, user } = useAuth();
  const { width } = useWindowDimensions();
  const tablet = isTabletWidth(width);

  const [server, setServer] = useState('');
  const [biometrics, setBiometrics] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [devTaps, setDevTaps] = useState(0);
  const [showServerDev, setShowServerDev] = useState(false);
  const devTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      setServer(await getApiBaseUrl());
      const v = await getSecureItem(StorageKeys.biometricsEnabled);
      setBiometrics(v === '1');
    })();
  }, []);

  async function saveServer() {
    await setServerUrl(server.trim());
    setSavedMsg('Server URL saved.');
    setTimeout(() => setSavedMsg(null), 2000);
  }

  async function toggleBiometrics(next: boolean) {
    setBiometrics(next);
    await setSecureItem(StorageKeys.biometricsEnabled, next ? '1' : '0');
  }

  function handleServerTap() {
    if (devTimer.current) clearTimeout(devTimer.current);
    const next = devTaps + 1;
    setDevTaps(next);
    if (next >= 5) {
      setShowServerDev(true);
    } else {
      devTimer.current = setTimeout(() => setDevTaps(0), 10_000);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scroll, tablet && styles.scrollTablet]}>
        <Card>
          <Text style={styles.section}>Account</Text>
          <Text style={styles.row}>
            {user ? `${user.firstName} ${user.lastName}` : '—'}
          </Text>
          <Text style={styles.muted}>{user?.email}</Text>
          <Button
            variant="danger"
            title="Sign out"
            onPress={signOut}
            fullWidth
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.section}>Security</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              Require biometric to open gate
            </Text>
            <Switch value={biometrics} onValueChange={toggleBiometrics} />
          </View>
          <Text style={styles.muted}>
            When enabled, Face ID or fingerprint must succeed before each gate
            unlock attempt.
          </Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Pressable onPress={handleServerTap}>
            <Text style={styles.section}>
              {showServerDev ? '🛠 Developer · Server' : 'Server'}
            </Text>
          </Pressable>
          {showServerDev ? (
            <>
              <Text style={styles.muted}>
                URL of the Glenridge HOA server.
              </Text>
              <TextInput
                style={styles.input}
                value={server}
                onChangeText={setServer}
                autoCapitalize="none"
                keyboardType="url"
              />
              <Button
                title="Save server URL"
                onPress={saveServer}
                fullWidth
                style={{ marginTop: spacing.sm }}
              />
              {savedMsg ? <Text style={styles.success}>{savedMsg}</Text> : null}
            </>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  scrollTablet: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  section: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  row: { fontSize: fontSize.md, color: colors.text, fontWeight: '600' },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    marginTop: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { fontSize: fontSize.md, color: colors.text, flex: 1, marginRight: spacing.md },
  success: { color: colors.success, marginTop: spacing.sm, fontSize: fontSize.sm },
});

import React, { useEffect, useState } from 'react';
import {
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
  const [unmask, setUnmask] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const isSuperAdmin = (user?.role || '').toLowerCase() === 'super-admin' ||
    (user?.role || '').toLowerCase() === 'super_admin';

  useEffect(() => {
    (async () => {
      setServer(await getApiBaseUrl());
      const v = await getSecureItem(StorageKeys.unmaskCredentials);
      setUnmask(v === '1');
    })();
  }, []);

  async function saveServer() {
    await setServerUrl(server.trim());
    setSavedMsg('Server URL saved.');
    setTimeout(() => setSavedMsg(null), 2000);
  }

  async function toggleUnmask(next: boolean) {
    if (next && !isSuperAdmin) return;
    setUnmask(next);
    await setSecureItem(StorageKeys.unmaskCredentials, next ? '1' : '0');
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
          {user?.role && <Text style={styles.muted}>Role: {user.role}</Text>}
          <Button
            variant="danger"
            title="Sign out"
            onPress={signOut}
            fullWidth
            style={{ marginTop: spacing.md }}
          />
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.section}>Credential display</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Unmask credential identifiers</Text>
            <Switch
              value={unmask}
              onValueChange={toggleUnmask}
              disabled={!isSuperAdmin}
            />
          </View>
          <Text style={styles.muted}>
            {isSuperAdmin
              ? 'When enabled, full RFID/phone identifiers are visible.'
              : 'Only super-admins can unmask credential identifiers.'}
          </Text>
        </Card>

        <Card style={{ marginTop: spacing.md }}>
          <Text style={styles.section}>Server</Text>
          <Text style={styles.muted}>URL of the Glenridge HOA server.</Text>
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
          {savedMsg && <Text style={styles.success}>{savedMsg}</Text>}
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

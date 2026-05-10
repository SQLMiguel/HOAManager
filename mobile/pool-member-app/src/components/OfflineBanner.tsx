import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getApiBaseUrl } from '@/api/client';
import { colors, fontSize, spacing } from '@/theme';

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const base = await getApiBaseUrl();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        await fetch(`${base}/api/me`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!cancelled) setOffline(false);
      } catch {
        if (!cancelled) setOffline(true);
      }
    }

    check();
    const interval = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!offline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>⚠ Can't reach server — check Wi-Fi or network</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});

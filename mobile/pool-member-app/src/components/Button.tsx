import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, fontSize, radius, spacing } from '@/theme';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  fullWidth,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const palette = variantPalette(variant);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border },
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && { opacity: 0.85 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      <View style={styles.contentRow}>
        {loading ? (
          <ActivityIndicator color={palette.text} />
        ) : (
          <Text style={[styles.text, { color: palette.text }]}>{title}</Text>
        )}
      </View>
    </Pressable>
  );
}

function variantPalette(variant: ButtonProps['variant']) {
  switch (variant) {
    case 'secondary':
      return { bg: colors.surface, border: colors.border, text: colors.text };
    case 'danger':
      return { bg: colors.danger, border: colors.danger, text: '#fff' };
    case 'primary':
    default:
      return { bg: colors.primary, border: colors.primaryDark, text: '#fff' };
  }
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  contentRow: { flexDirection: 'row', alignItems: 'center' },
  text: { fontSize: fontSize.md, fontWeight: '600' },
});

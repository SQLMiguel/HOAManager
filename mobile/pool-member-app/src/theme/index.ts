/**
 * Design tokens shared across the Pool Member App.
 * Colors and spacing chosen for sunlight readability at the pool gate.
 */

export const colors = {
  primary: '#1e7e74',
  primaryDark: '#155a52',
  background: '#f5f7f6',
  surface: '#ffffff',
  text: '#1a1a1a',
  textMuted: '#5a5a5a',
  border: '#dfe5e3',
  success: '#2d7a3a',
  danger: '#b53b2e',
  warning: '#c08a16',
  info: '#1f6feb',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
};

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

/**
 * Returns true when the device is in a tablet-class viewport so screens can
 * switch to multi-column layouts.
 */
export function isTabletWidth(width: number): boolean {
  return width >= 768;
}

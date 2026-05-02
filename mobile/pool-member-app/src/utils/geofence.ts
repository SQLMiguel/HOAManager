import * as Location from 'expo-location';
import Constants from 'expo-constants';

export interface GeofenceResult {
  ok: boolean;
  reason?: string;
  distanceMeters?: number;
}

/**
 * Verify the device is within the configured geofence around the pool gate.
 * Pool coordinates and radius are configured via app.json `extra` keys:
 *   - poolLatitude
 *   - poolLongitude
 *   - poolGeofenceMeters
 */
export async function checkPoolGeofence(): Promise<GeofenceResult> {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, number>;
  const lat = Number(extra.poolLatitude);
  const lon = Number(extra.poolLongitude);
  const radius = Number(extra.poolGeofenceMeters) || 250;

  if (!lat || !lon) {
    // Geofence not configured — allow but flag to UI
    return { ok: true, reason: 'geofence_not_configured' };
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, reason: 'permission_denied' };
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const distance = haversineMeters(
    position.coords.latitude,
    position.coords.longitude,
    lat,
    lon,
  );

  return {
    ok: distance <= radius,
    reason: distance <= radius ? undefined : 'outside_geofence',
    distanceMeters: Math.round(distance),
  };
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

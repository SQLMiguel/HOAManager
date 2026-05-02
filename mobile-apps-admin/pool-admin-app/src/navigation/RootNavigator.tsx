import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/auth/AuthContext';
import { LoginScreen } from '@/screens/LoginScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { GuestsScreen } from '@/screens/GuestsScreen';
import { GuestDetailScreen } from '@/screens/GuestDetailScreen';
import { CheckinsScreen } from '@/screens/CheckinsScreen';
import { GateSyncScreen } from '@/screens/GateSyncScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { colors } from '@/theme';

export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Guests: undefined;
  GuestDetail: { memberId: string; memberName: string };
  Checkins: undefined;
  GateSync: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      {user ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Pool Admin' }} />
          <Stack.Screen name="Guests" component={GuestsScreen} options={{ title: 'Guests & Vendors' }} />
          <Stack.Screen
            name="GuestDetail"
            component={GuestDetailScreen}
            options={({ route }) => ({ title: route.params.memberName })}
          />
          <Stack.Screen name="Checkins" component={CheckinsScreen} options={{ title: 'Live Entries' }} />
          <Stack.Screen name="GateSync" component={GateSyncScreen} options={{ title: 'Gate Sync' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

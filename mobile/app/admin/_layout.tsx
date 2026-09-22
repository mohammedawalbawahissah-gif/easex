import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { AdminDrawerButton } from '../../src/components/AdminDrawer';

// Same waiting/redirect pattern as (tabs)/_layout.tsx, plus an
// is_staff check — a customer who navigates here directly bounces
// to Home rather than seeing a broken screen. The backend enforces
// this independently on every /api/admin/ endpoint either way.
export default function AdminStackLayout() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (!user.is_staff) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: 'Sora_600SemiBold', color: colors.ink, fontSize: 17 },
        headerBackTitle: 'Back',
        headerLeft: () => <AdminDrawerButton />,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Admin' }} />
      <Stack.Screen name="kyc" options={{ title: 'Verification queue' }} />
      <Stack.Screen name="giftcards" options={{ title: 'Gift card review' }} />
      <Stack.Screen name="transactions" options={{ title: 'Transactions' }} />
      <Stack.Screen name="compliance" options={{ title: 'Compliance flags' }} />
      <Stack.Screen name="support" options={{ title: 'Support' }} />
      <Stack.Screen name="copilot" options={{ title: 'Copilot' }} />
      <Stack.Screen name="users" options={{ title: 'Users' }} />
    </Stack>
  );
}

import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import HeaderIcons from '../../src/components/HeaderIcons';
import { colors, fonts } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';

// Tabs are gone — every feature is now a card on Home, reached by
// pushing onto this Stack. Notifications and Account are no longer
// screens you tab into either; they're modals opened from the bell
// and person icons in the header (see HeaderIcons), present on every
// screen here so they're always one tap away, same as web's AppShell.
export default function HomeStackLayout() {
  const { user, initializing } = useAuth();

  // Wait for session restoration before deciding whether to show the
  // app or bounce to login — avoids a flash of the wrong screen.
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

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: 'Sora_600SemiBold', color: colors.ink, fontSize: 17 },
        headerRight: () => <HeaderIcons />,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerTitle: () => (
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink }}>
              Ease<Text style={{ color: colors.gold }}>X</Text>
            </Text>
          ),
        }}
      />
      <Stack.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Stack.Screen name="trade" options={{ title: 'Trade' }} />
      <Stack.Screen name="giftcards" options={{ title: 'Gift cards' }} />
      <Stack.Screen name="add-money" options={{ title: 'Add money' }} />
      <Stack.Screen name="withdraw" options={{ title: 'Withdraw' }} />
      <Stack.Screen name="send" options={{ title: 'Send' }} />
      <Stack.Screen name="scheduled" options={{ title: 'Scheduled' }} />
      <Stack.Screen name="payouts" options={{ title: 'Payout accounts' }} />
      <Stack.Screen name="security" options={{ title: 'Security' }} />
      <Stack.Screen name="verification" options={{ title: 'Verify your account' }} />
      <Stack.Screen
        name="notifications"
        options={{ title: 'Notifications', presentation: 'modal', headerRight: undefined }}
      />
      <Stack.Screen
        name="account"
        options={{ title: 'Account', presentation: 'modal', headerRight: undefined }}
      />
    </Stack>
  );
}

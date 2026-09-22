import { useEffect, useState } from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { easex } from "../lib/easexClient";
import { colors, fonts } from "../theme";

/**
 * Rendered in the header of every main screen (see app/(tabs)/_layout.tsx
 * screenOptions), matching web's AppShell: Notifications and Account
 * live behind these two icons rather than taking up tab-bar space.
 * Tapping either pushes its screen as a modal (see the "presentation:
 * modal" options on those Stack.Screen entries).
 */
export default function HeaderIcons() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    easex.notifications
      .list()
      .then((list) => {
        if (!cancelled) setUnreadCount(list.filter((n) => !n.is_read).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={() => router.push("/(tabs)/notifications")}
        accessibilityLabel="Notifications"
      >
        <SymbolView
          name={{ ios: "bell", android: "notifications", web: "bell" }}
          tintColor={colors.inkSoft}
          size={22}
        />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={() => router.push("/(tabs)/account")}
        accessibilityLabel="Account"
      >
        <SymbolView
          name={{ ios: "person.circle", android: "account_circle", web: "user" }}
          tintColor={colors.inkSoft}
          size={22}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 8 },
  iconBtn: { padding: 6, position: "relative" },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 100,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  badgeText: { fontFamily: fonts.bodySemiBold, fontSize: 9, color: "#fff" },
});

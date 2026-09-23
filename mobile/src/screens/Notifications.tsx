import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import type { Notification } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { colors, fonts } from "../theme";
import { useAuth } from "../context/AuthContext";
import { resolveNotificationTarget } from "../lib/notificationLink";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    easex.notifications
      .list()
      .then(setNotifications)
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = async (n: Notification) => {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      easex.notifications.markRead(n.id).catch(() => {
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: false } : x)));
      });
    }
    const target = resolveNotificationTarget(n, !!user?.is_staff);
    router.dismissTo((target ?? `/notification/${n.id}`) as never);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Notifications</Text>

      <View style={styles.passbook}>
        {loading ? (
          <Text style={styles.emptyRow}>Loading…</Text>
        ) : notifications.length === 0 ? (
          <Text style={styles.emptyRow}>You're all caught up.</Text>
        ) : (
          notifications.map((n) => (
            <TouchableOpacity key={n.id} style={styles.row} activeOpacity={0.6} onPress={() => handleOpen(n)}>
              <View style={{ flexShrink: 1, gap: 2 }}>
                <Text style={[styles.rowTitle, { fontFamily: n.is_read ? fonts.bodyRegular : fonts.bodySemiBold }]}>
                  {n.title}
                </Text>
                {!!n.body && <Text style={styles.rowBody}>{n.body}</Text>}
              </View>
              <Text style={styles.rowTime}>{timeAgo(n.created_at)}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, marginBottom: 20 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowTitle: { fontSize: 14, color: colors.ink },
  rowBody: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  rowTime: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginLeft: 12 },
  emptyRow: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, fontSize: 14, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
});

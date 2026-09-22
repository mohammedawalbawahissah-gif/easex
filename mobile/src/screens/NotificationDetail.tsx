import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { Notification } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { colors, fonts } from "../theme";

const CATEGORY_LABELS: Record<string, string> = {
  transaction_update: "Transaction update",
  kyc_update: "Verification update",
  system: "System",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [notification, setNotification] = useState<Notification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    easex.notifications
      .get(id)
      .then((n) => {
        if (cancelled) return;
        setNotification(n);
        if (!n.is_read) easex.notifications.markRead(id).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this notification.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : error || !notification ? (
        <Text style={styles.error}>{error ?? "Notification not found."}</Text>
      ) : (
        <>
          <Text style={styles.title}>{notification.title}</Text>
          <Text style={styles.timestamp}>{formatDateTime(notification.created_at)}</Text>

          {!!notification.body && <Text style={styles.body}>{notification.body}</Text>}

          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.passbook}>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>Category</Text>
              <Text style={styles.rowMeta}>
                {CATEGORY_LABELS[notification.category] ?? notification.category}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>Received</Text>
              <Text style={styles.rowMeta}>{formatDateTime(notification.created_at)}</Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink, marginBottom: 4 },
  timestamp: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft, marginBottom: 16 },
  body: { fontFamily: fonts.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.ink },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 28, marginBottom: 12 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  rowMeta: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
});

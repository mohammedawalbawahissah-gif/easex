import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import type { AdminDashboardStats } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";

const TILES = [
  { key: "pending_kyc", label: "Pending verifications", to: "/admin/kyc" },
  { key: "giftcards_under_review", label: "Gift cards to review", to: "/admin/giftcards" },
  { key: "transactions_awaiting_settlement", label: "Awaiting settlement", to: "/admin/transactions" },
  { key: "withdrawals_awaiting_review", label: "Withdrawals to review", to: "/admin/transactions" },
  { key: "loads_awaiting_confirmation", label: "Wallet loads to confirm", to: "/admin/transactions" },
  { key: "open_compliance_flags", label: "Open compliance flags", to: "/admin/compliance" },
] as const satisfies readonly { key: keyof AdminDashboardStats; label: string; to: string }[];

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    easex.admin
      .dashboard()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : stats ? (
        <>
          <View style={styles.grid}>
            {TILES.map((t) => (
              <TouchableOpacity key={t.key} style={styles.tile} onPress={() => router.push(t.to)}>
                <Text style={styles.tileValue}>{stats[t.key] as number}</Text>
                <Text style={styles.tileLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.muted, { marginBottom: 8 }]}>
            Gift card auto-payment is {stats.giftcard_auto_payment_enabled ? "ON" : "OFF"} (change it in Django admin → Payment settings).
          </Text>

          <Text style={styles.sectionTitle}>Users by verification tier</Text>
          <View style={styles.passbook}>
            {Object.entries(stats.users_by_tier).map(([tier, count]) => (
              <View key={tier} style={styles.row}>
                <Text style={styles.rowTitle}>{tier}</Text>
                <Text style={styles.rowMeta}>{count}</Text>
              </View>
            ))}
            <View style={styles.row}>
              <Text style={[styles.rowTitle, { fontFamily: fonts.bodySemiBold }]}>Total</Text>
              <Text style={[styles.rowMeta, { fontFamily: fonts.bodySemiBold }]}>{stats.total_users}</Text>
            </View>
          </View>
        </>
      ) : (
        <Text style={styles.error}>Couldn't load dashboard stats.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 20, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 28 },
  tile: {
    flexBasis: "47%",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 16,
    backgroundColor: colors.paperRaised,
    gap: 4,
  },
  tileValue: { fontFamily: fonts.monoSemiBold, fontSize: 24, color: colors.ink },
  tileLabel: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginBottom: 12 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink, textTransform: "capitalize" },
  rowMeta: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
});

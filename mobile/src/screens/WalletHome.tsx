import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { buildBalanceHistory, TRANSACTION_TYPE_LABELS, transactionDirection, transactionSubtitle } from "@easex/shared";
import type { Wallet, Transaction } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import { colors, fonts, statusColors, statusLabel } from "../theme";
import ChartCard from "../components/ChartCard";
import SparkChart from "../components/SparkChart";
import AssetIcon from "../components/AssetIcon";
import { formatMoney } from "../lib/money";

function formatAmount(amount: string) {
  return Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WalletHomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllWallets, setShowAllWallets] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [w, t] = await Promise.all([easex.wallets.list(), easex.transactions.list()]);
        if (!cancelled) {
          setWallets(w);
          setTransactions(t);
        }
      } catch {
        if (!cancelled) setError("Couldn't load your wallet. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryWallet = wallets.find((w) => w.currency === "GHS") ?? wallets[0];

  // Backend now returns a zero-balance row for every currency, so
  // default to only the ones with real activity — "All wallets"
  // expands to the full set.
  const activeWallets = wallets.filter((w) => Number(w.balance) > 0 || Number(w.escrow_balance) > 0);
  const displayedWallets = showAllWallets ? wallets : activeWallets;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.greeting}>Welcome{user ? `, ${user.username}` : ""}</Text>

      <View style={styles.balanceRow}>
        <Text style={styles.balanceFigure}>
          {primaryWallet ? formatAmount(primaryWallet.balance) : "0.00"}
        </Text>
        <Text style={styles.balanceCurrency}>{primaryWallet?.currency ?? "GHS"}</Text>
      </View>

      {user && user.kyc_tier === "unverified" && (
        <TouchableOpacity style={styles.notice} onPress={() => router.push("/(tabs)/verification")}>
          <Text style={styles.noticeText}>
            Your account isn't verified yet, so your transaction limit is 0. Tap to complete verification.
          </Text>
        </TouchableOpacity>
      )}

      {user && user.kyc_tier === "basic" && (
        <TouchableOpacity style={styles.notice} onPress={() => router.push("/(tabs)/verification")}>
          <Text style={styles.noticeText}>
            Your transaction limit is 2,000 GHS. Tap to verify your ID and raise it to 50,000 GHS.
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.actionRow}>
        {[
          { label: "Load Wallet", glyph: "＋", to: "/(tabs)/add-money" },
          { label: "Transfer Funds", glyph: "↗", to: "/(tabs)/send" },
          { label: "Make Withdrawal", glyph: "↓", to: "/(tabs)/withdraw" },
          { label: "Schedule Transaction", glyph: "◷", to: "/(tabs)/scheduled" },
        ].map((a) => (
          <TouchableOpacity key={a.label} style={styles.actionBtn} onPress={() => router.push(a.to as never)} accessibilityRole="button">
            <Text style={styles.actionGlyph}>{a.glyph}</Text>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : (
        <>
          {primaryWallet && (
            <ChartCard title={`${primaryWallet.currency} balance history`}>
              <SparkChart
                points={buildBalanceHistory(transactions, primaryWallet.currency).map((p) => ({
                  label: new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                  value: p.value,
                }))}
                valueFormatter={(v) =>
                  `${primaryWallet.currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                }
                emptyMessage="No settled activity yet."
              />
            </ChartCard>
          )}

          {wallets.length > 1 && (
            <>
              <TouchableOpacity
                style={styles.sectionToggle}
                onPress={() => setShowAllWallets((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showAllWallets }}
              >
                <Text style={styles.sectionToggleText}>All wallets</Text>
                <Text style={[styles.sectionChevron, showAllWallets && styles.sectionChevronOpen]}>▾</Text>
              </TouchableOpacity>
              <View style={styles.passbook}>
                {displayedWallets.map((w) => (
                  <View key={w.id} style={styles.row}>
                    <View style={styles.walletRowMain}>
                      <AssetIcon currency={w.currency} size={26} />
                      <View>
                        <Text style={styles.rowTitle}>{w.currency}</Text>
                        {Number(w.escrow_balance) > 0 && (
                          <Text style={styles.rowSubtle}>{formatAmount(w.escrow_balance)} on hold</Text>
                        )}
                      </View>
                    </View>
                    <Text style={styles.rowAmount}>{formatAmount(w.balance)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Recent transactions</Text>
          <View style={styles.passbook}>
            {transactions.length === 0 ? (
              <Text style={styles.emptyRow}>Nothing here yet. Add money or sell a gift card to get started.</Text>
            ) : (
              transactions.slice(0, 10).map((t) => {
                const sc = statusColors[t.status] ?? { bg: colors.line, fg: colors.inkSoft };
                return (
                  <Pressable
                    key={t.id}
                    style={styles.row}
                    onPress={() => router.push(`/transaction/${t.id}`)}
                  >
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{TRANSACTION_TYPE_LABELS[t.transaction_type]}</Text>
                      {!!transactionSubtitle(t) && <Text style={styles.rowSubtle}>{transactionSubtitle(t)}</Text>}
                      <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                        <View style={[styles.statusDot, { backgroundColor: sc.fg }]} />
                        <Text style={[styles.statusText, { color: sc.fg }]}>{statusLabel(t.status)}</Text>
                      </View>
                    </View>
                    <Text style={styles.rowAmount}>
                      {transactionDirection(t.transaction_type) === "out" ? "− " : transactionDirection(t.transaction_type) === "in" ? "+ " : ""}
                      {formatMoney(t.amount, t.currency)}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  greeting: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 2 },
  balanceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 20 },
  balanceFigure: { fontFamily: fonts.monoSemiBold, fontSize: 32, color: colors.ink },
  balanceCurrency: { fontFamily: fonts.bodyRegular, fontSize: 15, color: colors.inkSoft, marginLeft: 8 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 20 },
  actionBtn: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: colors.paperRaised },
  actionGlyph: { fontSize: 18, color: colors.gold },
  actionLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.ink, textAlign: "center" },
  notice: { backgroundColor: colors.warningBg, borderRadius: 6, padding: 14, marginTop: 16 },
  noticeText: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.ink },
  errorText: { fontFamily: fonts.bodyRegular, color: colors.danger, marginTop: 12 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, marginTop: 32 },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 32, marginBottom: 12 },
  sectionToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 32,
    marginBottom: 12,
  },
  sectionChevron: { fontSize: 12, color: colors.inkSoft },
  sectionChevronOpen: { transform: [{ rotate: "180deg" }] },
  sectionToggleText: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowMain: { flexShrink: 1, gap: 4 },
  walletRowMain: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  rowSubtle: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  rowAmount: { fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.ink },
  emptyRow: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, fontSize: 14, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 9, borderRadius: 100 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
});

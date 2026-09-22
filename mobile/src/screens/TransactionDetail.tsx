import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Transaction } from "@easex/shared";
import { TRANSACTION_TYPE_LABELS as TYPE_LABELS } from "@easex/shared";
import { formatMoney } from "../lib/money";
import { easex } from "../lib/easexClient";
import { colors, fonts, statusColors, statusLabel } from "../theme";

const STATUS_EXPLANATION: Record<Transaction["status"], string> = {
  pending: "This transaction hasn't started review yet.",
  under_review: "Our team is reviewing this — usually within a few hours.",
  verified: "This has been verified and is queued for payout.",
  settled: "Complete. Funds have moved.",
  rejected: "This transaction was rejected and won't be processed further.",
  flagged: "This has been flagged for a closer compliance review.",
};

/** Extra rows drawn from the transaction's metadata, depending on what kind it is. */
function extraRows(t: Transaction): { label: string; value: string; mono?: boolean }[] {
  const m = t.metadata as Record<string, unknown>;
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);

  if (str(m.counterparty_username)) {
    rows.push({ label: t.transaction_type === "transfer_out" ? "To" : "From", value: `@${m.counterparty_username}` });
  }
  if (str(m.note)) rows.push({ label: "Note", value: String(m.note) });
  if (str(m.reference)) rows.push({ label: "Payment reference", value: String(m.reference), mono: true });
  const d = m.destination as Record<string, string> | undefined;
  if (d) {
    rows.push({
      label: "Sent to",
      value: d.address ? `${d.address}${d.memo ? ` (tag ${d.memo})` : ""}` : `${d.network?.toUpperCase()} · ${d.account_number} · ${d.account_name}`,
      mono: Boolean(d.address),
    });
    if (d.address && d.network) rows.push({ label: "Network", value: d.network });
  }
  if (str(m.failure_reason)) rows.push({ label: "Reason", value: String(m.failure_reason) });
  if (str(m.rejection_reason)) rows.push({ label: "Reason", value: String(m.rejection_reason) });
  return rows;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    easex.transactions
      .get(id)
      .then((t) => {
        if (!cancelled) setTransaction(t);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this transaction.");
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
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : error || !transaction ? (
        <Text style={styles.error}>{error ?? "Transaction not found."}</Text>
      ) : (
        <>
          <Text style={styles.title}>{TYPE_LABELS[transaction.transaction_type]}</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceFigure}>
              {formatMoney(transaction.amount, transaction.currency).replace(`${transaction.currency} `, "")}
            </Text>
            <Text style={styles.balanceCurrency}>{transaction.currency}</Text>
          </View>

          {(() => {
            const sc = statusColors[transaction.status] ?? { bg: colors.line, fg: colors.inkSoft };
            return (
              <View style={[styles.statusPill, { backgroundColor: sc.bg, marginTop: 12 }]}>
                <Text style={[styles.statusText, { color: sc.fg }]}>
                  {statusLabel(transaction.status)}
                </Text>
              </View>
            );
          })()}
          <Text style={styles.explanation}>{STATUS_EXPLANATION[transaction.status]}</Text>
          {transaction.transaction_type === "wallet_load" && transaction.status === "under_review" &&
            typeof transaction.metadata.instructions === "string" && !!transaction.metadata.instructions && (
              <Text style={[styles.explanation, { color: colors.ink, backgroundColor: colors.warningBg, padding: 12, borderRadius: 6 }]}>
                {transaction.metadata.instructions}
              </Text>
            )}

          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.passbook}>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>Reference</Text>
              <Text style={styles.rowMono}>{transaction.id.slice(0, 8)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>Submitted</Text>
              <Text style={styles.rowMeta}>{formatDateTime(transaction.created_at)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>Last updated</Text>
              <Text style={styles.rowMeta}>{formatDateTime(transaction.updated_at)}</Text>
            </View>
            {extraRows(transaction).map((r) => (
              <View style={styles.row} key={r.label + r.value}>
                <Text style={styles.rowTitle}>{r.label}</Text>
                <Text selectable style={[r.mono ? styles.rowMono : styles.rowMeta, { flexShrink: 1, textAlign: "right", marginLeft: 16 }]}>{r.value}</Text>
              </View>
            ))}
            {!!transaction.external_reference && (
              <View style={styles.row}>
                <Text style={styles.rowTitle}>External reference</Text>
                <Text style={styles.rowMono}>{transaction.external_reference}</Text>
              </View>
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
  back: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSoft, marginBottom: 16 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, marginBottom: 4 },
  balanceRow: { flexDirection: "row", alignItems: "baseline" },
  balanceFigure: { fontFamily: fonts.monoSemiBold, fontSize: 26, color: colors.ink },
  balanceCurrency: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginLeft: 8 },
  statusPill: { alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 9, borderRadius: 100 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
  explanation: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 8 },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 28, marginBottom: 12 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  rowMeta: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
  rowMono: { fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.ink },
});

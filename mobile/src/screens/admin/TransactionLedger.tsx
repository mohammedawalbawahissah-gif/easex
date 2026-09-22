import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet } from "react-native";
import type { AdminTransaction, TransactionStatus } from "@easex/shared";
import { TRANSACTION_TYPE_LABELS, apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { formatMoney } from "../../lib/money";
import { colors, fonts } from "../../theme";
import StatusPill from "../../components/StatusPill";
import FilterChips from "../../components/FilterChips";

const WITHDRAWALS = "fiat_payout,crypto_withdrawal";

const STATUS_FILTERS = [
  { value: "verified", label: "Awaiting settlement" },
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under review" },
  { value: "settled", label: "Settled" },
  { value: "rejected", label: "Rejected" },
  { value: "flagged", label: "Flagged" },
  { value: "", label: "All" },
];

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: WITHDRAWALS, label: "Withdrawals" },
  { value: "wallet_load", label: "Wallet loads" },
  { value: "transfer_out", label: "Transfers" },
  { value: "giftcard_sale", label: "Gift cards" },
  { value: "crypto_trade", label: "Trades" },
];

const isWithdrawal = (t: AdminTransaction) => t.transaction_type === "fiat_payout" || t.transaction_type === "crypto_withdrawal";

/** What an admin needs to actually pay a withdrawal, or to match a load. */
function detailsOf(t: AdminTransaction): string | null {
  const m = t.metadata as Record<string, unknown>;
  const d = m.destination as Record<string, string> | undefined;
  const parts: string[] = [];
  if (d?.address) parts.push(`${d.network}: ${d.address}${d.memo ? ` (tag ${d.memo})` : ""}`);
  else if (d?.account_number) parts.push(`${d.network?.toUpperCase()} ${d.account_number} — ${d.account_name}`);
  if (typeof m.reference === "string") parts.push(`Ref ${m.reference} · ${String(m.network ?? "").toUpperCase()} ${String(m.phone_number ?? "")}`);
  if (m.needs_reconciliation) parts.push("⚠ Provider didn't respond — check the provider dashboard before paying again");
  if (m.provider_state === "pending") parts.push("Sent to provider, awaiting confirmation");
  return parts.length ? parts.join(" · ") : null;
}

export default function AdminTransactionLedgerScreen() {
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | "">("verified");
  const [typeFilter, setTypeFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    easex.admin.transactions
      .list({ status: (statusFilter || undefined) as TransactionStatus | undefined, type: typeFilter || undefined })
      .then(setTransactions)
      .catch(() => setError("Couldn't load transactions."))
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter]);

  useEffect(load, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(apiErrorMessage(err, "That didn't work — please try again."));
    } finally {
      setBusyId(null);
      setRejectingId(null);
      setReason("");
      load();
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <FilterChips options={TYPE_FILTERS} value={typeFilter} onChange={setTypeFilter} />
      <FilterChips options={STATUS_FILTERS} value={statusFilter} onChange={(v) => setStatusFilter(v as TransactionStatus | "")} />

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : transactions.length === 0 ? (
        <Text style={styles.muted}>Nothing here.</Text>
      ) : (
        transactions.map((t) => {
          const details = detailsOf(t);
          const open = t.status === "under_review" || t.status === "pending" || t.status === "flagged";
          // Gift cards are approved on their own screen (needs the redemption attestation).
          const canReview = open && t.transaction_type !== "giftcard_sale" && (t.transaction_type === "wallet_load" || isWithdrawal(t));
          return (
            <View key={t.id} style={styles.row}>
              <View style={styles.rowTop}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.rowTitle}>{t.username}</Text>
                  <Text style={styles.rowSub}>{TRANSACTION_TYPE_LABELS[t.transaction_type]} · {formatMoney(t.amount, t.currency)}</Text>
                  <Text style={styles.rowDate}>{new Date(t.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
                </View>
                <StatusPill status={t.status} />
              </View>
              {!!details && <Text selectable style={styles.details}>{details}</Text>}

              <View style={styles.actions}>
                {canReview && t.transaction_type === "wallet_load" && (
                  <TouchableOpacity
                    style={styles.settleBtn}
                    disabled={busyId === t.id}
                    onPress={() =>
                      act(t.id, async () => {
                        if (t.status !== "verified") await easex.admin.transactions.transition(t.id, "verified");
                        await easex.admin.transactions.settle(t.id);
                      })
                    }
                  >
                    <Text style={styles.settleBtnText}>Confirm received</Text>
                  </TouchableOpacity>
                )}
                {canReview && isWithdrawal(t) && (
                  <TouchableOpacity style={styles.settleBtn} disabled={busyId === t.id} onPress={() => act(t.id, () => easex.admin.transactions.transition(t.id, "verified"))}>
                    <Text style={styles.settleBtnText}>Approve</Text>
                  </TouchableOpacity>
                )}
                {canReview && (
                  <TouchableOpacity style={styles.rejectBtn} disabled={busyId === t.id} onPress={() => { setRejectingId(t.id); setReason(""); }}>
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                )}
                {t.status === "verified" && (
                  <TouchableOpacity style={styles.settleBtn} onPress={() => act(t.id, () => easex.admin.transactions.settle(t.id))} disabled={busyId === t.id}>
                    <Text style={styles.settleBtnText}>{isWithdrawal(t) ? "Mark paid" : "Settle"}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {rejectingId === t.id && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.label}>Reason (shown to the user, optional)</Text>
                  <TextInput style={styles.input} value={reason} onChangeText={setReason} />
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.rejectBtn} disabled={busyId === t.id} onPress={() => act(t.id, () => easex.admin.transactions.transition(t.id, "rejected", reason.trim()))}>
                      <Text style={styles.rejectBtnText}>Confirm reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setRejectingId(null)}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 16, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginBottom: 12 },
  row: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, backgroundColor: colors.paperRaised, marginBottom: 10 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  rowTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  rowSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  rowDate: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.inkSoft, marginTop: 2 },
  details: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.ink, marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSoft, marginBottom: 4 },
  input: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 9, paddingHorizontal: 10 },
  settleBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 12 },
  settleBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#17130A" },
  rejectBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 12 },
  rejectBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.danger },
  cancelBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 12 },
  cancelBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.ink },
});

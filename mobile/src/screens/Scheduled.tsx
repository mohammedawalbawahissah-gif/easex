import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { ScheduledLoad, ScheduledTransfer, ScheduledWithdrawal } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { formatMoney } from "../lib/money";
import { colors, fonts } from "../theme";
import StatusPill from "../components/StatusPill";
import { Screen, Title, PrimaryButton, Message, Segmented } from "../components/ui";

type Status = "scheduled" | "completed" | "failed" | "cancelled";

const PILL_STATUS: Record<Status, string> = {
  scheduled: "under_review",
  completed: "settled",
  failed: "rejected",
  cancelled: "pending",
};

type Kind = "transfers" | "loads" | "withdrawals";

const TABS: { value: Kind; label: string }[] = [
  { value: "transfers", label: "Transfers" },
  { value: "loads", label: "Loads" },
  { value: "withdrawals", label: "Withdrawals" },
];

const NEW_ROUTE: Record<Kind, string> = {
  transfers: "/(tabs)/send",
  loads: "/(tabs)/add-money",
  withdrawals: "/(tabs)/withdraw",
};

const NEW_LABEL: Record<Kind, string> = {
  transfers: "New scheduled transfer",
  loads: "New scheduled load",
  withdrawals: "New scheduled withdrawal",
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function shortAddress(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function ScheduledScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Kind>("transfers");

  const [transfers, setTransfers] = useState<ScheduledTransfer[]>([]);
  const [loads, setLoads] = useState<ScheduledLoad[]>([]);
  const [withdrawals, setWithdrawals] = useState<ScheduledWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      easex.payments.scheduled.list(),
      easex.payments.scheduledLoads.list(),
      easex.payments.scheduledWithdrawals.list(),
    ])
      .then(([t, l, w]) => {
        setTransfers(t);
        setLoads(l);
        setWithdrawals(w);
      })
      .catch(() => setError("Couldn't load your scheduled transactions."))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  const cancel = async (kind: Kind, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      if (kind === "transfers") await easex.payments.scheduled.cancel(id);
      else if (kind === "loads") await easex.payments.scheduledLoads.cancel(id);
      else await easex.payments.scheduledWithdrawals.cancel(id);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen>
      <Title>Schedule Transaction</Title>
      <Segmented options={TABS} value={tab} onChange={(v) => setTab(v as Kind)} />
      <PrimaryButton
        title={NEW_LABEL[tab]}
        onPress={() => router.push({ pathname: NEW_ROUTE[tab] as never, params: { mode: "later" } })}
      />
      {error && <Message kind="error">{error}</Message>}

      <View style={styles.list}>
        {loading ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : tab === "transfers" ? (
          transfers.length === 0 ? (
            <Text style={styles.empty}>No scheduled transfers.</Text>
          ) : (
            transfers.map((s) => (
              <View key={s.id} style={styles.row}>
                <View style={{ flexShrink: 1, gap: 4 }}>
                  <Text style={styles.title}>{formatMoney(s.amount, s.currency)} → @{s.recipient_username}</Text>
                  <Text style={styles.meta}>
                    {when(s.run_at)}
                    {s.status === "failed" && s.failure_reason ? ` · ${s.failure_reason}` : ""}
                  </Text>
                  <StatusPill status={PILL_STATUS[s.status]} />
                </View>
                {s.status === "scheduled" && (
                  <TouchableOpacity style={styles.cancel} onPress={() => cancel("transfers", s.id)} disabled={busyId === s.id}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )
        ) : tab === "loads" ? (
          loads.length === 0 ? (
            <Text style={styles.empty}>No scheduled wallet loads.</Text>
          ) : (
            loads.map((s) => (
              <View key={s.id} style={styles.row}>
                <View style={{ flexShrink: 1, gap: 4 }}>
                  <Text style={styles.title}>{formatMoney(s.amount, "GHS")} · {s.network.toUpperCase()}</Text>
                  <Text style={styles.meta}>
                    {when(s.run_at)}
                    {s.status === "failed" && s.failure_reason ? ` · ${s.failure_reason}` : ""}
                  </Text>
                  <StatusPill status={PILL_STATUS[s.status]} />
                </View>
                {s.status === "scheduled" && (
                  <TouchableOpacity style={styles.cancel} onPress={() => cancel("loads", s.id)} disabled={busyId === s.id}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )
        ) : withdrawals.length === 0 ? (
          <Text style={styles.empty}>No scheduled withdrawals.</Text>
        ) : (
          withdrawals.map((s) => (
            <View key={s.id} style={styles.row}>
              <View style={{ flexShrink: 1, gap: 4 }}>
                <Text style={styles.title}>{formatMoney(s.amount, s.currency)}</Text>
                <Text style={styles.meta}>
                  {when(s.run_at)} · {s.currency === "GHS" ? "To saved payout account" : `To ${shortAddress(s.address)}`}
                  {s.status === "failed" && s.failure_reason ? ` · ${s.failure_reason}` : ""}
                </Text>
                <StatusPill status={PILL_STATUS[s.status]} />
              </View>
              {s.status === "scheduled" && (
                <TouchableOpacity style={styles.cancel} onPress={() => cancel("withdrawals", s.id)} disabled={busyId === s.id}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  meta: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft },
  empty: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, fontSize: 14, paddingVertical: 20 },
  cancel: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
  cancelText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
});

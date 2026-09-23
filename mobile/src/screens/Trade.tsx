import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useKeyboardHeight } from "../lib/useKeyboardHeight";
import { useRouter } from "expo-router";
import type { ExchangeRate, ExchangeRateHistoryPoint, TradableCurrency, TradeDirection } from "@easex/shared";
import { ApiError } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { colors, fonts } from "../theme";
import { CURRENCY_META } from "../lib/currencyMeta";
import AssetIcon from "../components/AssetIcon";
import ChartCard from "../components/ChartCard";
import SparkChart from "../components/SparkChart";

const POLL_MS = 30_000;

/** "#rrggbb" + an alpha -> "#rrggbbAA", for a subtle per-asset tile tint. */
function withAlpha(hex: string, alpha: number) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}

function percentChange(history: ExchangeRateHistoryPoint[], currency: TradableCurrency): number | null {
  const points = history.filter((p) => p.currency === currency);
  if (points.length < 2) return null;
  const first = Number(points[0].buy_rate);
  const last = Number(points[points.length - 1].buy_rate);
  if (first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

export default function TradeScreen() {
  const keyboardHeight = useKeyboardHeight();
  const router = useRouter();
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [rateHistory, setRateHistory] = useState<ExchangeRateHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  // null = just the market grid; tapping a tile opens the buy/sell panel for it.
  const [currency, setCurrency] = useState<TradableCurrency | null>(null);
  const [direction, setDirection] = useState<TradeDirection>("buy");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    easex.exchange.rates().then(setRates).catch(() => {});
    easex.exchange.rateHistory().then(setRateHistory).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    setLoading(false);
    // Wired for live: once real market pricing lands, this poll is
    // what makes the ticker and chart move on their own.
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const currentRate = currency ? rates.find((r) => r.currency === currency) : undefined;
  const price = currentRate ? Number(direction === "buy" ? currentRate.buy_rate : currentRate.sell_rate) : 0;
  const estimatedGhs = amount
    ? (Number(amount) * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";

  const openCurrency = (c: TradableCurrency) => {
    setCurrency(c);
    setDirection("buy");
    setAmount("");
    setError(null);
    setSuccessMsg(null);
  };

  const closePanel = () => {
    setCurrency(null);
    setAmount("");
    setError(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async () => {
    if (!currency) return;
    setError(null);
    setSuccessMsg(null);
    if (!amount || Number(amount) <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setSubmitting(true);
    try {
      await easex.exchange.trade({ currency, direction, amount });
      setSuccessMsg("Trade complete — check your wallet.");
      setAmount("");
      refresh();
      setTimeout(() => router.push("/(tabs)/wallet"), 1200);
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "detail" in err.body) {
        setError((err.body as { detail: string }).detail);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingBottom: keyboardHeight }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Trade crypto</Text>
      <Text style={styles.subtitle}>Updated automatically as the market moves.</Text>

      {loading ? (
        <Text style={styles.muted}>Loading rates…</Text>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Markets</Text>
          <View style={styles.assetGrid}>
            {rates.map((r) => {
              const change = percentChange(rateHistory, r.currency);
              const selected = r.currency === currency;
              const accent = CURRENCY_META[r.currency].color;
              return (
                <TouchableOpacity
                  key={r.currency}
                  style={[
                    styles.assetTile,
                    { borderTopColor: accent, backgroundColor: withAlpha(accent, 0.07) },
                    selected && { borderColor: accent, borderWidth: 2 },
                  ]}
                  onPress={() => openCurrency(r.currency)}
                >
                  <AssetIcon currency={r.currency} size={32} />
                  <Text style={styles.assetTileSymbol}>{r.currency}</Text>
                  <Text style={styles.assetTilePrice}>GHS {Number(r.buy_rate).toLocaleString()}</Text>
                  {change === null ? (
                    <Text style={styles.tickerChangeMuted}>—</Text>
                  ) : (
                    <View
                      style={[
                        styles.tickerChangeBadge,
                        { backgroundColor: change >= 0 ? colors.successBg : colors.dangerBg },
                      ]}
                    >
                      <Text style={[styles.tickerChangeText, { color: change >= 0 ? colors.success : colors.danger }]}>
                        {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {currency && (
            <View style={styles.tradePanel}>
              <TouchableOpacity onPress={closePanel}>
                <Text style={styles.tradePanelClose}>← Back to markets</Text>
              </TouchableOpacity>

              <ChartCard title={`${currency} · ${CURRENCY_META[currency].name} (GHS)`}>
                <SparkChart
                  points={rateHistory
                    .filter((r) => r.currency === currency)
                    .map((r) => ({
                      label: new Date(r.recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      value: Number(r.buy_rate),
                    }))}
                  valueFormatter={(v) => `GHS ${v.toLocaleString()}`}
                  emptyMessage="Not enough history yet for this asset."
                />
              </ChartCard>

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, direction === "buy" && styles.toggleButtonActive]}
                  onPress={() => setDirection("buy")}
                >
                  <Text style={[styles.toggleText, direction === "buy" && styles.toggleTextActive]}>Buy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, direction === "sell" && styles.toggleButtonActive]}
                  onPress={() => setDirection("sell")}
                >
                  <Text style={[styles.toggleText, direction === "sell" && styles.toggleTextActive]}>Sell</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.tradingAssetLine}>
                Trading <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{currency}</Text> — tap a
                different asset above to switch.
              </Text>

              <Text style={styles.label}>Amount ({currency})</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
              />

              <Text style={styles.estimate}>
                Estimated {direction === "buy" ? "cost" : "payout"}:{" "}
                <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{estimatedGhs} GHS</Text>
              </Text>

              {error && <Text style={styles.error}>{error}</Text>}
              {successMsg && <Text style={styles.success}>{successMsg}</Text>}

              <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
                <Text style={styles.buttonText}>
                  {submitting ? "Processing…" : direction === "buy" ? `Buy ${currency}` : `Sell ${currency}`}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 2, marginBottom: 20 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginBottom: 12 },
  assetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  assetTile: {
    width: "31%",
    borderWidth: 1,
    borderColor: colors.line,
    borderTopWidth: 3,
    borderRadius: 10,
    backgroundColor: colors.paperRaised,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 6,
  },
  assetTileSymbol: { fontFamily: fonts.displaySemiBold, fontSize: 13, color: colors.ink },
  assetTilePrice: { fontFamily: fonts.monoSemiBold, fontSize: 11, color: colors.inkSoft },
  tickerChangeBadge: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 100 },
  tickerChangeText: { fontFamily: fonts.monoSemiBold, fontSize: 11 },
  tickerChangeMuted: { fontFamily: fonts.monoSemiBold, fontSize: 11, color: colors.inkSoft },
  tradePanel: { marginTop: 20, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.line },
  tradePanelClose: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.goldDeep,
    paddingTop: 14,
    paddingBottom: 4,
  },
  toggleRow: { flexDirection: "row", gap: 8, marginBottom: 8, marginTop: 4 },
  toggleButton: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 12, alignItems: "center" },
  toggleButtonActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  toggleText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  toggleTextActive: { color: "#17130A" },
  tradingAssetLine: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft, marginBottom: 4 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSoft, marginBottom: 6, marginTop: 14 },
  input: {
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    padding: 12,
    backgroundColor: colors.paperRaised,
    color: colors.ink,
  },
  estimate: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 12 },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginTop: 8, fontSize: 13 },
  success: { fontFamily: fonts.bodyRegular, color: colors.success, marginTop: 8, fontSize: 13 },
  button: { backgroundColor: colors.gold, padding: 14, borderRadius: 6, marginTop: 20, alignItems: "center" },
  buttonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 15 },
});

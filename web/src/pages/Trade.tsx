import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { ExchangeRate, ExchangeRateHistoryPoint, TradableCurrency, TradeDirection } from "@easex/shared";
import { ApiError } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { CURRENCY_META } from "../lib/currencyMeta";
import AppShell from "../components/AppShell";
import AssetIcon from "../components/AssetIcon";
import SparkChart from "../components/SparkChart";

const POLL_MS = 30_000;

function percentChange(history: ExchangeRateHistoryPoint[], currency: TradableCurrency): number | null {
  const points = history.filter((p) => p.currency === currency);
  if (points.length < 2) return null;
  const first = Number(points[0].buy_rate);
  const last = Number(points[points.length - 1].buy_rate);
  if (first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

export default function Trade() {
  const navigate = useNavigate();
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [rateHistory, setRateHistory] = useState<ExchangeRateHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  // null = just the market grid; picking a tile opens the buy/sell panel for it.
  const [currency, setCurrency] = useState<TradableCurrency | null>(null);
  const [direction, setDirection] = useState<TradeDirection>("buy");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const refresh = () => {
    easex.exchange.rates().then(setRates).catch(() => {});
    easex.exchange.rateHistory().then(setRateHistory).catch(() => {});
  };

  useEffect(() => {
    refresh();
    setLoading(false);
    // Wired for live: once real market pricing lands, this poll is
    // what makes the ticker and chart move on their own — no other
    // change needed on this end.
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const currentRate = currency ? rates.find((r) => r.currency === currency) : undefined;
  const price = currentRate ? Number(direction === "buy" ? currentRate.buy_rate : currentRate.sell_rate) : 0;
  const estimatedGhs = amount ? (Number(amount) * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";

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
      setSuccessMsg(`Trade complete — check your wallet.`);
      setAmount("");
      refresh();
      setTimeout(() => navigate("/wallet"), 1200);
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
    <AppShell>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Trade crypto</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 24 }}>
        Updated automatically as the market moves.
      </p>

      {loading ? (
        <p>Loading rates…</p>
      ) : (
        <>
          <h2 className="section-title">Markets</h2>
          <div className="asset-grid">
            {rates.map((r) => {
              const change = percentChange(rateHistory, r.currency);
              const selected = r.currency === currency;
              return (
                <button
                  key={r.currency}
                  type="button"
                  className={`asset-tile${selected ? " asset-tile-selected" : ""}`}
                  style={{ "--tile-accent": CURRENCY_META[r.currency].color } as CSSProperties}
                  onClick={() => openCurrency(r.currency)}
                >
                  <AssetIcon currency={r.currency} size={34} />
                  <div className="asset-tile-symbol">{r.currency}</div>
                  <div className="asset-tile-price">GHS {Number(r.buy_rate).toLocaleString()}</div>
                  {change === null ? (
                    <span className="ticker-row-change-muted">—</span>
                  ) : (
                    <span className={`ticker-row-change ${change >= 0 ? "spark-change-up" : "spark-change-down"}`}>
                      {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {currency && (
            <div className="trade-panel">
              <button type="button" className="trade-panel-close" onClick={closePanel} aria-label="Close">
                ← Back to markets
              </button>

              <div className="chart-card" style={{ marginTop: 12 }}>
                <div className="chart-card-title">
                  {currency} · {CURRENCY_META[currency].name} (GHS)
                </div>
                <SparkChart
                  points={rateHistory
                    .filter((p) => p.currency === currency)
                    .map((p) => ({
                      label: new Date(p.recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      value: Number(p.buy_rate),
                    }))}
                  valueFormatter={(v) => `GHS ${v.toLocaleString()}`}
                  emptyMessage="Not enough history yet for this asset."
                />
              </div>

              <div className="auth-form" style={{ marginTop: 24 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <button
                    type="button"
                    className={direction === "buy" ? "btn-primary" : "btn-secondary"}
                    style={{ flex: 1, marginTop: 0 }}
                    onClick={() => setDirection("buy")}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    className={direction === "sell" ? "btn-primary" : "btn-secondary"}
                    style={{ flex: 1, marginTop: 0 }}
                    onClick={() => setDirection("sell")}
                  >
                    Sell
                  </button>
                </div>

                <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "8px 0 0" }}>
                  Trading <strong style={{ color: "var(--ink)" }}>{currency}</strong> — pick a different asset above to
                  switch.
                </p>

                <div className="field">
                  <label htmlFor="amount">Amount ({currency})</label>
                  <input
                    id="amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
                  Estimated {direction === "buy" ? "cost" : "payout"}: <strong style={{ color: "var(--ink)" }}>{estimatedGhs} GHS</strong>
                </p>

                {error && <p className="form-error" role="alert">{error}</p>}
                {successMsg && <p style={{ color: "var(--success)", fontSize: 14 }}>{successMsg}</p>}

                <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Processing…" : direction === "buy" ? `Buy ${currency}` : `Sell ${currency}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

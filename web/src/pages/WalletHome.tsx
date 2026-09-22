import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { buildBalanceHistory, TRANSACTION_TYPE_LABELS, TRANSACTION_STATUS_LABELS, transactionDirection, transactionSubtitle } from "@easex/shared";
import type { Wallet, Transaction } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import AppShell from "../components/AppShell";
import SparkChart from "../components/SparkChart";
import AssetIcon from "../components/AssetIcon";
import { formatMoney } from "../lib/money";

function formatAmount(amount: string, currency: string) {
  return formatMoney(amount, currency);
}

export default function WalletHome() {
  const { user } = useAuth();
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

  // The backend now returns a wallet row for every supported
  // currency (zero balance ones included), so by default only show
  // the ones with actual activity — "All wallets" expands to the
  // complete set on demand.
  const activeWallets = wallets.filter((w) => Number(w.balance) > 0 || Number(w.escrow_balance) > 0);
  const displayedWallets = showAllWallets ? wallets : activeWallets;

  return (
    <AppShell>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>
        Welcome{user ? `, ${user.username}` : ""}
      </h1>

      {primaryWallet ? (
        <div style={{ marginTop: 20 }}>
          <span className="balance-figure">{Number(primaryWallet.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="balance-currency">{primaryWallet.currency}</span>
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <span className="balance-figure">0.00</span>
          <span className="balance-currency">GHS</span>
        </div>
      )}

      {user && user.kyc_tier === "unverified" && (
        <p className="notice">
          Your account isn't verified yet, so your transaction limit is 0. <Link to="/verification">Complete verification</Link> to start trading.
        </p>
      )}

      {user && user.kyc_tier === "basic" && (
        <p className="notice">
          Your transaction limit is 2,000 GHS. <Link to="/verification">Verify your ID</Link> to raise it to 50,000 GHS.
        </p>
      )}

      <div className="action-row">
        <Link to="/wallet/add" className="action-btn"><span className="action-btn-icon">＋</span>Load Wallet</Link>
        <Link to="/wallet/send" className="action-btn"><span className="action-btn-icon">↗</span>Transfer Funds</Link>
        <Link to="/wallet/withdraw" className="action-btn"><span className="action-btn-icon">↓</span>Make Withdrawal</Link>
        <Link to="/wallet/scheduled" className="action-btn"><span className="action-btn-icon">◷</span>Schedule Transaction</Link>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p style={{ marginTop: 32, color: "var(--ink-soft)" }}>Loading…</p>
      ) : (
        <>
          {primaryWallet && (
            <div className="chart-card">
              <div className="chart-card-title">
                {primaryWallet.currency} balance history
              </div>
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
            </div>
          )}

          {wallets.length > 1 && (
            <>
              <button
                type="button"
                className="section-title section-title-toggle"
                onClick={() => setShowAllWallets((v) => !v)}
                aria-expanded={showAllWallets}
              >
                <span>All wallets</span>
                <span className={`section-title-chevron${showAllWallets ? " section-title-chevron-open" : ""}`}>
                  ▾
                </span>
              </button>
              <div className="passbook">
                {displayedWallets.map((w) => (
                  <div className="passbook-row" key={w.id}>
                    <div className="passbook-row-main" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <AssetIcon currency={w.currency} size={26} />
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span className="passbook-row-title">{w.currency}</span>
                        {Number(w.escrow_balance) > 0 && (
                          <span className="passbook-row-meta">
                            {formatAmount(w.escrow_balance, w.currency)} on hold
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="passbook-row-amount">{formatAmount(w.balance, w.currency)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 className="section-title">Recent transactions</h2>
          <div className="passbook">
            {transactions.length === 0 ? (
              <div className="empty-row">
                Nothing here yet. Add money or sell a gift card to get started.
              </div>
            ) : (
              transactions.slice(0, 10).map((t) => (
                <Link
                  to={`/transactions/${t.id}`}
                  className="passbook-row"
                  key={t.id}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="passbook-row-main">
                    <span className="passbook-row-title">{TRANSACTION_TYPE_LABELS[t.transaction_type]}</span>
                    {transactionSubtitle(t) && <span className="passbook-row-meta">{transactionSubtitle(t)}</span>}
                    <span className={`status-pill status-${t.status}`}>{TRANSACTION_STATUS_LABELS[t.status]}</span>
                  </div>
                  <span className="passbook-row-amount">
                    {transactionDirection(t.transaction_type) === "out" ? "− " : transactionDirection(t.transaction_type) === "in" ? "+ " : ""}
                    {formatAmount(t.amount, t.currency)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

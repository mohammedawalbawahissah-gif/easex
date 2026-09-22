import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ScheduledLoad, ScheduledTransfer, ScheduledWithdrawal } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { formatMoney } from "../lib/money";
import AppShell from "../components/AppShell";

type Status = "scheduled" | "completed" | "failed" | "cancelled";

const STATUS_CLASS: Record<Status, string> = {
  scheduled: "under_review",
  completed: "settled",
  failed: "rejected",
  cancelled: "pending",
};

const STATUS_LABEL: Record<Status, string> = {
  scheduled: "Scheduled",
  completed: "Sent",
  failed: "Didn't send",
  cancelled: "Cancelled",
};

type Kind = "transfers" | "loads" | "withdrawals";

const TABS: { key: Kind; label: string; newHref: string }[] = [
  { key: "transfers", label: "Transfer funds", newHref: "/wallet/send?mode=later" },
  { key: "loads", label: "Load wallet", newHref: "/wallet/add?mode=later" },
  { key: "withdrawals", label: "Withdrawals", newHref: "/wallet/withdraw?mode=later" },
];

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function shortAddress(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function Scheduled() {
  const [tab, setTab] = useState<Kind>("transfers");

  const [transfers, setTransfers] = useState<ScheduledTransfer[]>([]);
  const [loads, setLoads] = useState<ScheduledLoad[]>([]);
  const [withdrawals, setWithdrawals] = useState<ScheduledWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = () => {
    setLoading(true);
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
  };

  useEffect(loadAll, []);

  const cancel = async (kind: Kind, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      if (kind === "transfers") await easex.payments.scheduled.cancel(id);
      else if (kind === "loads") await easex.payments.scheduledLoads.cancel(id);
      else await easex.payments.scheduledWithdrawals.cancel(id);
      loadAll();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <AppShell>
      <Link to="/wallet" style={{ fontSize: 14, color: "var(--ink-soft)" }}>← Back to wallet</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 20px" }}>
        <h1 style={{ fontSize: 22 }}>Schedule Transaction</h1>
        <Link to={activeTab.newHref} className="btn-secondary" style={{ textDecoration: "none" }}>New</Link>
      </div>

      <div className="seg" role="group" aria-label="Scheduled transaction type">
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="passbook" style={{ marginTop: 16 }}>
        {loading ? (
          <div className="empty-row">Loading…</div>
        ) : tab === "transfers" ? (
          transfers.length === 0 ? (
            <div className="empty-row">No scheduled transfers.</div>
          ) : (
            transfers.map((s) => (
              <div className="passbook-row" key={s.id}>
                <div className="passbook-row-main">
                  <span className="passbook-row-title">
                    {formatMoney(s.amount, s.currency)} → @{s.recipient_username}
                  </span>
                  <span className="passbook-row-meta">
                    {when(s.run_at)}
                    {s.status === "failed" && s.failure_reason ? ` · ${s.failure_reason}` : ""}
                  </span>
                  <span className={`status-pill status-${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                </div>
                {s.status === "scheduled" && (
                  <button className="btn-secondary" onClick={() => cancel("transfers", s.id)} disabled={busyId === s.id}>
                    Cancel
                  </button>
                )}
              </div>
            ))
          )
        ) : tab === "loads" ? (
          loads.length === 0 ? (
            <div className="empty-row">No scheduled wallet loads.</div>
          ) : (
            loads.map((s) => (
              <div className="passbook-row" key={s.id}>
                <div className="passbook-row-main">
                  <span className="passbook-row-title">
                    {formatMoney(s.amount, "GHS")} · {s.network.toUpperCase()}
                  </span>
                  <span className="passbook-row-meta">
                    {when(s.run_at)}
                    {s.status === "failed" && s.failure_reason ? ` · ${s.failure_reason}` : ""}
                  </span>
                  <span className={`status-pill status-${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                </div>
                {s.status === "scheduled" && (
                  <button className="btn-secondary" onClick={() => cancel("loads", s.id)} disabled={busyId === s.id}>
                    Cancel
                  </button>
                )}
              </div>
            ))
          )
        ) : withdrawals.length === 0 ? (
          <div className="empty-row">No scheduled withdrawals.</div>
        ) : (
          withdrawals.map((s) => (
            <div className="passbook-row" key={s.id}>
              <div className="passbook-row-main">
                <span className="passbook-row-title">{formatMoney(s.amount, s.currency)}</span>
                <span className="passbook-row-meta">
                  {when(s.run_at)} · {s.currency === "GHS" ? "To saved payout account" : `To ${shortAddress(s.address)}`}
                  {s.status === "failed" && s.failure_reason ? ` · ${s.failure_reason}` : ""}
                </span>
                <span className={`status-pill status-${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
              </div>
              {s.status === "scheduled" && (
                <button className="btn-secondary" onClick={() => cancel("withdrawals", s.id)} disabled={busyId === s.id}>
                  Cancel
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

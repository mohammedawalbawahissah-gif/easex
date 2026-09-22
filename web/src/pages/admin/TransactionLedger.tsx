import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminTransaction, TransactionStatus } from "@easex/shared";
import { TRANSACTION_TYPE_LABELS, apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { formatMoney } from "../../lib/money";
import AdminShell from "../../components/AdminShell";

const WITHDRAWALS = "fiat_payout,crypto_withdrawal";

function isWithdrawal(t: AdminTransaction) {
  return t.transaction_type === "fiat_payout" || t.transaction_type === "crypto_withdrawal";
}

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

export default function AdminTransactionLedger() {
  const [params] = useSearchParams();
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | "">((params.get("status") as TransactionStatus) ?? "verified");
  const [typeFilter, setTypeFilter] = useState(params.get("type") ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    easex.admin.transactions
      .list({ status: statusFilter || undefined, type: typeFilter || undefined })
      .then(setTransactions)
      .catch(() => setError("Couldn't load transactions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter, typeFilter]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "That didn't work — please try again."));
      load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = (t: AdminTransaction) => {
    const reason = window.prompt("Reason (shown to the user, optional):") ?? null;
    if (reason === null) return;
    act(t.id, () => easex.admin.transactions.transition(t.id, "rejected", reason));
  };

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22 }}>Transactions</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="admin-select">
            <option value="">All types</option>
            <option value={WITHDRAWALS}>Withdrawals</option>
            <option value="wallet_load">Wallet loads</option>
            <option value="transfer_out">Transfers</option>
            <option value="giftcard_sale">Gift cards</option>
            <option value="crypto_trade">Trades</option>
            <option value="crypto_deposit">Crypto deposits</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TransactionStatus | "")} className="admin-select">
            <option value="verified">Verified — awaiting settlement</option>
            <option value="pending">Pending</option>
            <option value="under_review">Under review</option>
            <option value="settled">Settled</option>
            <option value="rejected">Rejected</option>
            <option value="flagged">Flagged</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : transactions.length === 0 ? (
        <p style={{ color: "var(--ink-soft)" }}>Nothing here.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>User</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const details = detailsOf(t);
              const open = t.status === "under_review" || t.status === "pending" || t.status === "flagged";
              // Gift cards are approved on their own screen (needs the redemption attestation).
              const canReview = open && t.transaction_type !== "giftcard_sale";
              return (
                <tr key={t.id}>
                  <td>{t.username}</td>
                  <td>
                    {TRANSACTION_TYPE_LABELS[t.transaction_type]}
                    {details && <div className="passbook-row-meta" style={{ maxWidth: 320, wordBreak: "break-word" }}>{details}</div>}
                  </td>
                  <td>{formatMoney(t.amount, t.currency)}</td>
                  <td><span className={`status-pill status-${t.status}`}>{t.status}</span></td>
                  <td>{new Date(t.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canReview && t.transaction_type === "wallet_load" && (
                      <button
                        className="btn-primary admin-table-btn"
                        disabled={busyId === t.id}
                        onClick={() => act(t.id, async () => {
                          if (t.status !== "verified") await easex.admin.transactions.transition(t.id, "verified");
                          await easex.admin.transactions.settle(t.id);
                        })}
                      >
                        Confirm received
                      </button>
                    )}
                    {canReview && isWithdrawal(t) && (
                      <button className="btn-primary admin-table-btn" disabled={busyId === t.id} onClick={() => act(t.id, () => easex.admin.transactions.transition(t.id, "verified"))}>
                        Approve
                      </button>
                    )}
                    {canReview && (t.transaction_type === "wallet_load" || isWithdrawal(t)) && (
                      <button className="btn-secondary admin-table-btn" style={{ marginLeft: 6 }} disabled={busyId === t.id} onClick={() => reject(t)}>
                        Reject
                      </button>
                    )}
                    {t.status === "verified" && (
                      <button className="btn-primary admin-table-btn" onClick={() => act(t.id, () => easex.admin.transactions.settle(t.id))} disabled={busyId === t.id}>
                        {isWithdrawal(t) ? "Mark paid" : "Settle"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}

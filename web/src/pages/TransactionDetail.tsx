import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { Transaction } from "@easex/shared";
import { TRANSACTION_TYPE_LABELS as TYPE_LABELS, TRANSACTION_STATUS_LABELS as STATUS_LABELS } from "@easex/shared";
import { formatMoney } from "../lib/money";
import { easex } from "../lib/easexClient";
import AppShell from "../components/AppShell";

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
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function TransactionDetail() {
  const { id } = useParams<{ id: string }>();
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
    <AppShell>
      <Link to="/wallet" style={{ fontSize: 14, color: "var(--ink-soft)" }}>
        ← Back to wallet
      </Link>

      {loading ? (
        <p style={{ marginTop: 20 }}>Loading…</p>
      ) : error || !transaction ? (
        <p className="form-error" role="alert" style={{ marginTop: 20 }}>
          {error ?? "Transaction not found."}
        </p>
      ) : (
        <>
          <h1 style={{ fontSize: 22, marginTop: 16, marginBottom: 4 }}>
            {TYPE_LABELS[transaction.transaction_type]}
          </h1>
          <span className="balance-figure" style={{ fontSize: 28 }}>
            {formatMoney(transaction.amount, transaction.currency).replace(`${transaction.currency} `, "")}
          </span>
          <span className="balance-currency">{transaction.currency}</span>

          <div style={{ marginTop: 16 }}>
            <span className={`status-pill status-${transaction.status}`}>
              {STATUS_LABELS[transaction.status]}
            </span>
          </div>
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 8 }}>
            {STATUS_EXPLANATION[transaction.status]}
          </p>
          {transaction.transaction_type === "wallet_load" && transaction.status === "under_review" &&
            typeof transaction.metadata.instructions === "string" && transaction.metadata.instructions && (
              <p className="notice" style={{ whiteSpace: "pre-wrap" }}>{transaction.metadata.instructions}</p>
            )}

          <h2 className="section-title">Details</h2>
          <div className="passbook">
            <div className="passbook-row">
              <span className="passbook-row-title">Reference</span>
              <span className="passbook-row-meta" style={{ fontFamily: "var(--font-mono)" }}>
                {transaction.id.slice(0, 8)}
              </span>
            </div>
            <div className="passbook-row">
              <span className="passbook-row-title">Submitted</span>
              <span className="passbook-row-meta">{formatDateTime(transaction.created_at)}</span>
            </div>
            <div className="passbook-row">
              <span className="passbook-row-title">Last updated</span>
              <span className="passbook-row-meta">{formatDateTime(transaction.updated_at)}</span>
            </div>
            {extraRows(transaction).map((r) => (
              <div className="passbook-row" key={r.label + r.value}>
                <span className="passbook-row-title">{r.label}</span>
                <span className="passbook-row-meta" style={r.mono ? { fontFamily: "var(--font-mono)", wordBreak: "break-all", textAlign: "right" } : { textAlign: "right" }}>{r.value}</span>
              </div>
            ))}
            {transaction.external_reference && (
              <div className="passbook-row">
                <span className="passbook-row-title">External reference</span>
                <span className="passbook-row-meta" style={{ fontFamily: "var(--font-mono)" }}>
                  {transaction.external_reference}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

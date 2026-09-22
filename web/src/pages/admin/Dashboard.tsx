import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminDashboardStats } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";

const TILES: { key: keyof AdminDashboardStats; label: string; to: string }[] = [
  { key: "pending_kyc", label: "Pending verifications", to: "/admin/kyc" },
  { key: "giftcards_under_review", label: "Gift cards to review", to: "/admin/giftcards" },
  { key: "transactions_awaiting_settlement", label: "Awaiting settlement", to: "/admin/transactions" },
  { key: "withdrawals_awaiting_review", label: "Withdrawals to review", to: "/admin/transactions?status=under_review&type=fiat_payout,crypto_withdrawal" },
  { key: "loads_awaiting_confirmation", label: "Wallet loads to confirm", to: "/admin/transactions?status=under_review&type=wallet_load" },
  { key: "open_compliance_flags", label: "Open compliance flags", to: "/admin/compliance" },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    easex.admin
      .dashboard()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Dashboard</h1>

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : stats ? (
        <>
          <div className="admin-tile-grid">
            {TILES.map((t) => (
              <Link key={t.key} to={t.to} className="admin-tile">
                <span className="admin-tile-value">{stats[t.key] as number}</span>
                <span className="admin-tile-label">{t.label}</span>
              </Link>
            ))}
          </div>

          <p className="hint" style={{ margin: "16px 0 0" }}>
            Gift card auto-payment is <strong>{stats.giftcard_auto_payment_enabled ? "ON" : "OFF"}</strong> (change it in Django admin → Payment settings).
          </p>

          <h2 className="section-title">Users by verification tier</h2>
          <div className="passbook">
            {Object.entries(stats.users_by_tier).map(([tier, count]) => (
              <div key={tier} className="passbook-row">
                <span className="passbook-row-title" style={{ textTransform: "capitalize" }}>
                  {tier}
                </span>
                <span className="passbook-row-meta">{count}</span>
              </div>
            ))}
            <div className="passbook-row">
              <span className="passbook-row-title" style={{ fontWeight: 600 }}>
                Total
              </span>
              <span className="passbook-row-meta" style={{ fontWeight: 600 }}>
                {stats.total_users}
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="form-error">Couldn't load dashboard stats.</p>
      )}
    </AdminShell>
  );
}

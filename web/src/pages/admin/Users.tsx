import { useEffect, useState } from "react";
import type { AdminUser } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    easex.admin.users
      .list({ search: search || undefined, kyc_tier: tierFilter || undefined })
      .then(setUsers)
      .catch(() => setError("Couldn't load users."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300); // debounce search-as-you-type
    return () => clearTimeout(t);
  }, [search, tierFilter]);

  const toggleFlag = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const updated = await easex.admin.users.toggleFlag(id);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch {
      setError("Couldn't update — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12 }}>
        <h1 style={{ fontSize: 22 }}>Users</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="admin-inline-input"
            placeholder="Search username, email, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="admin-select">
            <option value="">All tiers</option>
            <option value="unverified">Unverified</option>
            <option value="basic">Basic</option>
            <option value="full">Full</option>
          </select>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : users.length === 0 ? (
        <p style={{ color: "var(--ink-soft)" }}>No users match.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Tier</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={u.is_flagged ? { background: "var(--danger-bg)" } : undefined}>
                <td>
                  {u.username} {u.is_staff && <span className="admin-staff-badge">staff</span>}
                </td>
                <td>{u.email}</td>
                <td>{u.phone_number}</td>
                <td style={{ textTransform: "capitalize" }}>{u.kyc_tier}</td>
                <td>{new Date(u.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                <td>
                  <button
                    className={u.is_flagged ? "btn-primary admin-table-btn" : "btn-secondary admin-table-btn admin-reject-btn"}
                    onClick={() => toggleFlag(u.id)}
                    disabled={busyId === u.id}
                  >
                    {u.is_flagged ? "Unflag" : "Flag"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AdminShell>
  );
}

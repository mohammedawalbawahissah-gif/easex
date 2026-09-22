import { useEffect, useState } from "react";
import type { ComplianceFlag } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";

export default function AdminComplianceFlags() {
  const [flags, setFlags] = useState<ComplianceFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    easex.admin.complianceFlags
      .list((statusFilter || undefined) as ComplianceFlag["status"] | undefined)
      .then(setFlags)
      .catch(() => setError("Couldn't load flags."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const resolve = async (id: string, status: "cleared" | "escalated") => {
    setBusyId(id);
    setError(null);
    try {
      await easex.admin.complianceFlags.resolve(id, status, notes[id]);
      load();
    } catch {
      setError("Couldn't update — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Compliance flags</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="admin-select">
          <option value="open">Open</option>
          <option value="reviewing">Reviewing</option>
          <option value="cleared">Cleared</option>
          <option value="escalated">Escalated</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : flags.length === 0 ? (
        <p style={{ color: "var(--ink-soft)" }}>Nothing here.</p>
      ) : (
        <div className="admin-card-list">
          {flags.map((f) => (
            <div key={f.id} className="admin-review-card">
              <div className="admin-review-header">
                <div>
                  <strong style={{ textTransform: "capitalize" }}>{f.reason.replace("_", " ")}</strong>
                  <span className="admin-review-sub">{f.username}</span>
                </div>
                <span className={`status-pill status-${f.status === "cleared" ? "verified" : f.status === "escalated" ? "rejected" : "pending"}`}>
                  {f.status}
                </span>
              </div>
              {f.notes && <p className="admin-review-rejection">{f.notes}</p>}

              {(f.status === "open" || f.status === "reviewing") && (
                <div className="admin-review-actions">
                  <input
                    className="admin-inline-input"
                    placeholder="Resolution notes"
                    value={notes[f.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [f.id]: e.target.value }))}
                  />
                  <button className="btn-primary" onClick={() => resolve(f.id, "cleared")} disabled={busyId === f.id}>
                    Clear
                  </button>
                  <button className="btn-secondary admin-reject-btn" onClick={() => resolve(f.id, "escalated")} disabled={busyId === f.id}>
                    Escalate
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

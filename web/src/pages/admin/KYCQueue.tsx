import { useEffect, useState } from "react";
import type { AdminKYCSubmission } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";
import KYCAssessmentPanel from "../../components/admin/KYCAssessmentPanel";

export default function AdminKYCQueue() {
  const [submissions, setSubmissions] = useState<AdminKYCSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReasonFor, setRejectReasonFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    easex.admin.kyc
      .list(statusFilter || undefined)
      .then(setSubmissions)
      .catch(() => setError("Couldn't load submissions."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [statusFilter]);

  const approve = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await easex.admin.kyc.review(id, "approve");
      load();
    } catch {
      setError("Couldn't approve — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await easex.admin.kyc.review(id, "reject", rejectReason);
      setRejectReasonFor(null);
      setRejectReason("");
      load();
    } catch {
      setError("Couldn't reject — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Verification queue</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="admin-select">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : submissions.length === 0 ? (
        <p style={{ color: "var(--ink-soft)" }}>Nothing here.</p>
      ) : (
        <div className="admin-card-list">
          {submissions.map((s) => (
            <div key={s.id} className="admin-review-card">
              <div className="admin-review-header">
                <div>
                  <strong>{s.full_name}</strong>
                  <span className="admin-review-sub">
                    {s.username} · {s.email} · currently {s.current_tier}
                  </span>
                </div>
                <span className={`status-pill status-${s.status === "pending" ? "pending" : s.status === "approved" ? "verified" : "rejected"}`}>
                  {s.status}
                </span>
              </div>

              <div className="admin-review-body">
                <div className="admin-review-field">
                  <span className="admin-review-field-label">ID type</span>
                  <span>{s.id_type.replace("_", " ")}</span>
                </div>
                <div className="admin-review-field">
                  <span className="admin-review-field-label">ID number</span>
                  <span>{s.id_number}</span>
                </div>
                <div className="admin-review-field">
                  <span className="admin-review-field-label">Date of birth</span>
                  <span>{s.date_of_birth}</span>
                </div>
              </div>

              <div className="admin-review-images">
                <a href={s.id_document_front} target="_blank" rel="noreferrer">
                  <img src={s.id_document_front} alt="ID front" className="admin-review-image" />
                </a>
                {s.id_document_back && (
                  <a href={s.id_document_back} target="_blank" rel="noreferrer">
                    <img src={s.id_document_back} alt="ID back" className="admin-review-image" />
                  </a>
                )}
                <a href={s.selfie} target="_blank" rel="noreferrer">
                  <img src={s.selfie} alt="Selfie" className="admin-review-image" />
                </a>
              </div>

              <KYCAssessmentPanel submissionId={s.id} />

              {s.status === "rejected" && s.rejection_reason && (
                <p className="admin-review-rejection">Reason: {s.rejection_reason}</p>
              )}

              {s.status === "pending" && (
                <div className="admin-review-actions">
                  {rejectReasonFor === s.id ? (
                    <>
                      <input
                        className="admin-inline-input"
                        placeholder="Rejection reason (shown to the user)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <button className="btn-primary" onClick={() => submitReject(s.id)} disabled={busyId === s.id}>
                        Confirm reject
                      </button>
                      <button className="btn-secondary" onClick={() => setRejectReasonFor(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn-primary" onClick={() => approve(s.id)} disabled={busyId === s.id}>
                        Approve
                      </button>
                      <button
                        className="btn-secondary admin-reject-btn"
                        onClick={() => setRejectReasonFor(s.id)}
                        disabled={busyId === s.id}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

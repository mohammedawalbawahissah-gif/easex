import { useEffect, useRef, useState } from "react";
import type { AdminSupportSession, SupportSessionStatus } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";

const REASON_LABELS: Record<string, string> = {
  user_requested: "Asked for a human",
  restricted_intent: "Sensitive topic",
  low_confidence: "Assistant couldn't help",
  manual: "Escalated by staff",
};

export default function AdminSupportQueue() {
  const [sessions, setSessions] = useState<AdminSupportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<SupportSessionStatus | "">("escalated");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    easex.admin.support
      .list(statusFilter || undefined)
      .then(setSessions)
      .catch(() => setError("Couldn't load the queue."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    load();
    // Simple poll — good enough at small team size. Swap for a
    // WebSocket (Django Channels) subscription if the queue outgrows this.
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const open = sessions.find((s) => s.id === openId) ?? null;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [open?.messages.length]);

  const claim = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await easex.admin.support.claim(id);
      setOpenId(id);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't claim this session."));
    } finally {
      setBusyId(null);
    }
  };

  const send = async () => {
    if (!open || !reply.trim()) return;
    setBusyId(open.id);
    setError(null);
    try {
      await easex.admin.support.sendMessage(open.id, reply.trim());
      setReply("");
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Message didn't send — try again."));
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async () => {
    if (!open) return;
    setBusyId(open.id);
    setError(null);
    try {
      await easex.admin.support.resolve(open.id);
      setOpenId(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't resolve this session."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Support</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SupportSessionStatus | "")}
          className="admin-select"
        >
          <option value="escalated">Waiting for an agent</option>
          <option value="admin_active">Being handled</option>
          <option value="bot_active">With the assistant</option>
          <option value="resolved">Resolved</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div className="admin-card-list" style={{ flex: "1 1 320px" }}>
          {loading ? (
            <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
          ) : sessions.length === 0 ? (
            <p style={{ color: "var(--ink-soft)" }}>Nothing here.</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="admin-review-card"
                style={{ cursor: "pointer", outline: s.id === openId ? "2px solid var(--brand-gold, gold)" : "none" }}
                onClick={() => setOpenId(s.id)}
              >
                <div className="admin-review-header">
                  <div>
                    <strong>{s.username}</strong>
                    <span className="admin-review-sub">
                      {s.subject || "General enquiry"}
                      {s.escalation_reason ? ` · ${REASON_LABELS[s.escalation_reason] ?? s.escalation_reason}` : ""}
                    </span>
                  </div>
                  <span className="admin-review-sub">{s.assigned_admin_username ?? "Unclaimed"}</span>
                </div>
                {s.status === "escalated" && (
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      claim(s.id);
                    }}
                  >
                    Claim
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {open && (
          <div className="admin-review-card" style={{ flex: "2 1 420px", display: "flex", flexDirection: "column", height: 480 }}>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {open.messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === "user" ? "flex-start" : "flex-end",
                    background: m.sender === "user" ? "var(--surface-2, #eee)" : "var(--brand-gold, gold)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    maxWidth: "80%",
                  }}
                >
                  {m.sender === "admin" && m.sender_admin_username && (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>{m.sender_admin_username}</div>
                  )}
                  {m.body}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {open.status === "admin_active" ? (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input
                  className="admin-select"
                  style={{ flex: 1 }}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Reply…"
                />
                <button type="button" disabled={busyId === open.id} onClick={send}>
                  Send
                </button>
                <button type="button" disabled={busyId === open.id} onClick={resolve}>
                  Resolve
                </button>
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 12 }}>
                {open.status === "escalated" ? "Claim this session to reply." : "This session isn't with an agent."}
              </p>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

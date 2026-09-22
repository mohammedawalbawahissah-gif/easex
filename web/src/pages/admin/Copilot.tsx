import { useState } from "react";
import type { CopilotMessage } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import AdminShell from "../../components/AdminShell";

export default function AdminCopilot() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const reply = await easex.admin.risk.copilot(next);
      setMessages([...next, reply]);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't reach the copilot."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Copilot</h1>
      <p className="hint" style={{ marginBottom: 16 }}>
        Ask about flags, transactions, or the review queues — e.g. "how many open velocity flags this week?"
        Read-only: it can't approve, reject, or change anything, and nothing here is saved once you leave the page.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="admin-card-list" style={{ minHeight: 300, marginBottom: 12, display: "flex", flexDirection: "column" }}>
        {messages.length === 0 ? (
          <p style={{ color: "var(--ink-soft)" }}>Ask a question to get started.</p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? "var(--brand-gold, gold)" : "var(--surface-2, #eee)",
                borderRadius: 8,
                padding: "8px 12px",
                margin: "6px 0",
                maxWidth: "80%",
              }}
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="admin-select"
          style={{ flex: 1 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && ask()}
          placeholder="Ask the copilot…"
        />
        <button type="button" disabled={busy || !text.trim()} onClick={ask}>
          Ask
        </button>
      </div>
    </AdminShell>
  );
}

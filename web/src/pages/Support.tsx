import { useEffect, useRef, useState } from "react";
import type { SupportSession } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import AppShell from "../components/AppShell";

const STATUS_LABEL: Record<string, string> = {
  bot_active: "Assistant",
  escalated: "Connecting you to an agent…",
  admin_active: "Agent",
  resolved: "Closed",
};

export default function Support() {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    easex.support
      .start()
      .then(setSession)
      .catch(() => setError("Couldn't start a support chat right now."))
      .finally(() => setLoading(false));
  }, []);

  // Poll while the assistant or an agent might still be typing — stop once
  // resolved, since nothing will change after that.
  useEffect(() => {
    if (!session || session.status === "resolved") return;
    const interval = setInterval(() => {
      easex.support.get(session.id).then(setSession).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [session?.id, session?.status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [session?.messages.length]);

  const send = async () => {
    if (!session || !text.trim() || session.status === "resolved") return;
    const body = text.trim();
    setText("");
    setSending(true);
    setError(null);
    try {
      const updated = await easex.support.sendMessage(session.id, { body });
      setSession(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Message didn't send — try again."));
    } finally {
      setSending(false);
    }
  };

  const talkToHuman = async () => {
    if (!session) return;
    setSending(true);
    setError(null);
    try {
      const updated = await easex.support.escalate(session.id);
      setSession(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't connect you to an agent — try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22 }}>Support</h1>
        {session && session.status !== "resolved" && (
          <span className="hint">{STATUS_LABEL[session.status] ?? session.status}</span>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <p className="hint">Loading…</p>
      ) : !session ? (
        <p className="hint">Support isn't available right now — please try again shortly.</p>
      ) : (
        <>
          <div
            className="passbook"
            style={{ minHeight: 320, maxHeight: "55vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: 12 }}
          >
            {session.messages.length === 0 && (
              <div className="empty-row">Ask about a transaction, your verification, or anything else — I'm happy to help.</div>
            )}
            {session.messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background: m.sender === "user" ? "var(--brand-gold, gold)" : "var(--surface-2, #f0f0f0)",
                  borderRadius: 10,
                  padding: "8px 12px",
                }}
              >
                {m.sender === "admin" && (
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                    {m.sender_admin_username ? `${m.sender_admin_username} · Agent` : "Agent"}
                  </div>
                )}
                {m.body}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {session.status === "resolved" ? (
            <p className="hint" style={{ marginTop: 12 }}>
              This conversation is closed. Sending a new message starts a fresh one.
            </p>
          ) : (
            <div className="field" style={{ marginTop: 12, flexDirection: "row", gap: 8, display: "flex" }}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !sending && send()}
                placeholder="Type a message…"
                style={{ flex: 1 }}
              />
              <button type="button" className="btn-primary" disabled={sending || !text.trim()} onClick={send}>
                Send
              </button>
            </div>
          )}

          {session.status === "bot_active" && (
            <button type="button" className="btn-secondary" style={{ marginTop: 10 }} disabled={sending} onClick={talkToHuman}>
              Talk to a person instead
            </button>
          )}
        </>
      )}
    </AppShell>
  );
}

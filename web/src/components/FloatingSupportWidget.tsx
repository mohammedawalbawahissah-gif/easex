import { useEffect, useRef, useState } from "react";
import type { SupportSession } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import { getGuestId } from "../lib/guestId";
import AppIcon from "./AppIcon";

/**
 * The `interactive-widget=resizes-content` viewport meta tag (see
 * index.html) handles this on Chrome/Android already, but Safari's
 * support is inconsistent — this tracks the actual visible height
 * directly via the VisualViewport API (falling back to innerHeight on
 * browsers without it) so the panel's height always accounts for an
 * open on-screen keyboard, on every mobile browser, not just the ones
 * that honor the meta tag.
 */
function useVisibleHeight() {
  const [height, setHeight] = useState(
    () => (typeof window !== "undefined" ? window.visualViewport?.height ?? window.innerHeight : 800)
  );
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setHeight(vv?.height ?? window.innerHeight);
    update();
    vv?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return height;
}

const STATUS_LABEL: Record<string, string> = {
  bot_active: "EaseX Assistant",
  escalated: "An Agent will be with you shortly",
  admin_active: "Agent",
  resolved: "Closed",
};

// Signed-in sessions are stored server-side per account and fetched fresh
// on open — never cached in localStorage — so they already follow the
// user across devices with no extra work here. A guest session is scoped
// to this browser's guest_id (see ../lib/guestId) until claimGuest() folds
// it into an account on login/signup.
const POLL_MS = 4000;

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l4 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M21.4 11.2 12.6 20a4.7 4.7 0 0 1-6.6-6.6l9-9a3.1 3.1 0 0 1 4.4 4.4l-9 9a1.6 1.6 0 0 1-2.2-2.2l8.1-8.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 3, alignSelf: "flex-start", padding: "8px 10px" }} aria-label="EaseX Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--ink-soft, #999)",
            opacity: 0.6,
            animation: `easex-typing-bounce 1.1s ${i * 0.15}s infinite ease-in-out`,
          }}
        />
      ))}
      <style>{`@keyframes easex-typing-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-3px); opacity: 1; } }`}</style>
    </div>
  );
}

function EaseXBrand({ suffix }: { suffix: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <AppIcon size={24} />
      <span>
        Ease<span className="brand-gold">X</span> {suffix}
      </span>
    </span>
  );
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isImageType(contentType: string) {
  return contentType.startsWith("image/");
}

type PanelView = "chat" | "history";

/**
 * Mounted once at the App root (outside the authenticated-only routes) so
 * it's available on every page, signed in or not. No session is created
 * until the user opens the bubble — idle browsing never starts a session
 * or wakes the assistant.
 */
export default function FloatingSupportWidget() {
  const { user } = useAuth();
  const visibleHeight = useVisibleHeight();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("chat");
  const [session, setSession] = useState<SupportSession | null>(null);
  const [history, setHistory] = useState<SupportSession[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingPast, setViewingPast] = useState<SupportSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [unread, setUnread] = useState(false);

  // Only read/create a guest id when actually needed (not signed in) —
  // never for a signed-in user, so a real account's requests never carry
  // a stray guest_id.
  const guestId = () => (user ? undefined : getGuestId());

  useEffect(() => {
    if (!open || session || loading) return;
    setLoading(true);
    easex.support
      .start(guestId())
      .then(setSession)
      .catch(() => setError("Couldn't start a support chat right now."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, loading, user]);

  const awaitingAssistant =
    !!session &&
    session.status === "bot_active" &&
    session.messages.length > 0 &&
    session.messages[session.messages.length - 1].sender === "user";

  useEffect(() => {
    if (!session || session.status === "resolved") return;
    const interval = setInterval(() => {
      easex.support
        .get(session.id, guestId())
        .then((updated) => {
          if (!open && updated.messages.length > session.messages.length) setUnread(true);
          setSession(updated);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status, session?.messages.length, open, user]);

  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

  useEffect(() => {
    if (open && view === "chat") bottomRef.current?.scrollIntoView({ block: "end" });
  }, [open, view, session?.messages.length, awaitingAssistant]);

  const openHistory = () => {
    setView("history");
    setViewingPast(null);
    setHistoryLoading(true);
    easex.support
      .list(guestId())
      .then((all) => setHistory(all.filter((s) => s.id !== session?.id)))
      .catch(() => setError("Couldn't load your past conversations."))
      .finally(() => setHistoryLoading(false));
  };

  const send = async () => {
    if (!session || session.status === "resolved") return;
    if (!text.trim() && !pendingFile) return;
    const body = text.trim();
    const attachment = pendingFile ?? undefined;
    setText("");
    setPendingFile(null);
    setSending(true);
    setError(null);
    try {
      const updated = await easex.support.sendMessage(session.id, { body: body || undefined, attachment, guestId: guestId() });
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
      const updated = await easex.support.escalate(session.id, guestId());
      setSession(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't connect you to an agent — try again."));
    } finally {
      setSending(false);
    }
  };

  const renderAttachment = (m: SupportSession["messages"][number]) => {
    if (!m.attachment_url) return null;
    if (isImageType(m.attachment_content_type)) {
      return (
        <a href={m.attachment_url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: m.body ? 6 : 0 }}>
          <img src={m.attachment_url} alt={m.attachment_name || "attachment"} style={{ maxWidth: "100%", borderRadius: 8, display: "block" }} />
        </a>
      );
    }
    return (
      <a
        href={m.attachment_url}
        target="_blank"
        rel="noreferrer"
        style={{ display: "block", marginTop: m.body ? 6 : 0, fontSize: 12.5, textDecoration: "underline" }}
      >
        📎 {m.attachment_name || "Attachment"}
      </a>
    );
  };

  const renderMessages = (s: SupportSession, showTyping: boolean) => (
    <>
      {s.messages.length === 0 ? (
        <div className="empty-row">Ask about a transaction, your verification, or anything else.</div>
      ) : (
        s.messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.sender === "user" ? "var(--brand-gold, gold)" : "var(--surface-2, #f0f0f0)",
              borderRadius: 10,
              padding: "7px 10px",
              fontSize: 13.5,
            }}
          >
            {m.sender === "admin" && (
              <div style={{ fontSize: 10.5, opacity: 0.7, marginBottom: 2 }}>
                {m.sender_admin_username ? `${m.sender_admin_username} · Agent` : "Agent"}
              </div>
            )}
            {m.body}
            {renderAttachment(m)}
          </div>
        ))
      )}
      {showTyping && <TypingDots />}
      <div ref={bottomRef} />
    </>
  );

  // On iOS Safari specifically, a `position: fixed` element stays anchored
  // to the full layout viewport, not the shrunken visual one — so without
  // this, the keyboard can cover the widget entirely rather than just
  // trimming its height. This computes how much of the screen the
  // keyboard is covering and lifts the widget by that amount.
  const keyboardInset = typeof window !== "undefined" ? Math.max(0, window.innerHeight - visibleHeight) : 0;
  const panelMaxHeight = Math.max(320, visibleHeight - 140);

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20 + keyboardInset, zIndex: 1000 }}>
      {open && (
        <div
          style={{
            width: 340,
            maxWidth: "calc(100vw - 40px)",
            height: Math.min(460, panelMaxHeight),
            maxHeight: panelMaxHeight,
            marginBottom: 12,
            background: "var(--surface, #fff)",
            borderRadius: 14,
            boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
          role="dialog"
          aria-label="EaseX Assistant"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom: "1px solid var(--border, #eee)",
            }}
          >
            <div>
              <strong style={{ fontSize: 14 }}>
                {view === "history" ? (
                  viewingPast ? (
                    "Past conversation"
                  ) : (
                    "History"
                  )
                ) : (
                  <EaseXBrand suffix="Assistant" />
                )}
              </strong>
              {view === "chat" && session && session.status !== "resolved" && (
                <div className="hint" style={{ fontSize: 12 }}>
                  {STATUS_LABEL[session.status] ?? session.status}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {view === "chat" ? (
                <button
                  type="button"
                  onClick={openHistory}
                  aria-label="View past conversations"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--ink-soft, #666)" }}
                >
                  <HistoryIcon />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => (viewingPast ? setViewingPast(null) : setView("chat"))}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: "var(--brand-gold, gold)" }}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close support chat"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {!user && view === "chat" && (
            <p className="hint" style={{ margin: "8px 14px 0", fontSize: 11.5 }}>
              Chatting as a guest — sign in to keep this conversation with your account.
            </p>
          )}

          {error && (
            <p className="form-error" role="alert" style={{ margin: "8px 14px 0", fontSize: 13 }}>
              {error}
            </p>
          )}

          {view === "history" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {viewingPast ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{renderMessages(viewingPast, false)}</div>
              ) : historyLoading ? (
                <p className="hint">Loading…</p>
              ) : !history || history.length === 0 ? (
                <p className="hint">No past conversations yet.</p>
              ) : (
                history
                  .slice()
                  .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setViewingPast(s)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: "var(--surface-2, #f5f5f5)",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 10px",
                        marginBottom: 6,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{s.subject || "Conversation"}</span>
                        <span className="hint" style={{ fontSize: 11 }}>
                          {timeAgo(s.updated_at)}
                        </span>
                      </div>
                      {s.messages.length > 0 && (
                        <div className="hint" style={{ fontSize: 12, marginTop: 2 }}>
                          {s.messages[s.messages.length - 1].body.slice(0, 60) || "Sent an attachment"}
                        </div>
                      )}
                    </button>
                  ))
              )}
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {loading ? (
                  <p className="hint">Loading…</p>
                ) : !session ? (
                  <p className="hint">Support isn't available right now — please try again shortly.</p>
                ) : (
                  renderMessages(session, awaitingAssistant)
                )}
              </div>

              {session && session.status === "bot_active" && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ margin: "0 12px 8px", fontSize: 12.5, padding: "6px 10px" }}
                  disabled={sending}
                  onClick={talkToHuman}
                >
                  Speak to an Agent.
                </button>
              )}

              {session && (
                <div style={{ borderTop: "1px solid var(--border, #eee)", padding: 12 }}>
                  {pendingFile && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "var(--surface-2, #f5f5f5)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        marginBottom: 6,
                        fontSize: 12,
                      }}
                    >
                      <span>📎 {pendingFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setPendingFile(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft, #666)" }}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      // No narrow `accept` here on purpose: on mobile browsers, accept="image/*,video/*"
                      // makes Safari/Chrome jump straight to a Photos quick-picker sheet instead of the
                      // full file browser. Leaving it open shows Files/Browse directly.
                      style={{ display: "none" }}
                      onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach a file"
                      disabled={sending}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "var(--ink-soft, #666)" }}
                    >
                      <PaperclipIcon />
                    </button>
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !sending && send()}
                      placeholder={session.status === "resolved" ? "Send a message to start a new chat…" : "Type a message…"}
                      style={{ flex: 1, fontSize: 13.5 }}
                      disabled={sending}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={sending || (!text.trim() && !pendingFile)}
                      onClick={send}
                      style={{ fontSize: 13 }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close EaseX Assistant" : "Open EaseX Assistant"}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--brand-gold, gold)",
          color: "#111",
          border: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && unread && (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#e03131",
              border: "2px solid var(--surface, #fff)",
            }}
          />
        )}
      </button>
    </div>
  );
}

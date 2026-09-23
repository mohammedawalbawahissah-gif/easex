import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { pickMedia } from "../lib/pickMedia";
import { useKeyboardHeight } from "../lib/useKeyboardHeight";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RNFilePart, SupportSession } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import { getGuestId } from "../lib/guestId";
import { colors, fonts } from "../theme";

const STATUS_LABEL: Record<string, string> = {
  bot_active: "EaseX Assistant",
  escalated: "An Agent will be with you shortly",
  admin_active: "Agent",
  resolved: "Closed",
};

// Signed-in sessions are stored server-side per account and fetched fresh
// on open — they already follow the user across devices. A guest session
// is scoped to this device's guest_id (see ../lib/guestId) until
// claimGuest() folds it into an account on login/signup.
const POLL_MS = 1500;

type PanelView = "chat" | "history";

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

function TypingDots() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 3), 350);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.typingRow} accessibilityLabel="EaseX Assistant is typing">
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.typingDot, { opacity: tick === i ? 1 : 0.35 }]} />
      ))}
    </View>
  );
}

/**
 * RN has no direct equivalent of a web "position: fixed" bubble, so this
 * uses the standard mobile pattern: an absolutely-positioned button that
 * opens the chat as a full Modal. Mounted once in app/_layout.tsx's
 * RootLayoutNav (the real root — see that file's own notes on why, not
 * the unused top-level App.tsx) so it persists across every route,
 * signed in or not.
 *
 * Attachments go through ../lib/pickMedia, which offers a real choice of
 * source (Photo/Video Library, Take Photo/Video, Browse Files) via the
 * native action sheet, rather than jumping straight into any one of them.
 */
export default function FloatingSupportWidget() {
  const { user } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Normally 72% of the screen; when the keyboard is up, shrink to
  // whatever fits above it (never below 280px) rather than just
  // shifting the same fixed height up, which could push the sheet's
  // own top off-screen on shorter devices or with a tall keyboard.
  const baseSheetHeight = windowHeight * 0.72;
  const topClearance = insets.top + 20;
  const sheetHeight =
    keyboardHeight > 0 ? Math.min(baseSheetHeight, Math.max(280, windowHeight - keyboardHeight - topClearance)) : baseSheetHeight;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("chat");
  const [session, setSession] = useState<SupportSession | null>(null);
  const [history, setHistory] = useState<SupportSession[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingPast, setViewingPast] = useState<SupportSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<RNFilePart | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const guestId = async () => (user ? undefined : getGuestId());

  useEffect(() => {
    if (!open || session || loading) return;
    setLoading(true);
    (async () => {
      try {
        const gid = await guestId();
        const s = await easex.support.start(gid);
        setSession(s);
      } catch {
        setError("Couldn't start a support chat right now.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, loading, user]);

  const awaitingAssistant =
    !!session &&
    session.status === "bot_active" &&
    session.messages.length > 0 &&
    session.messages[session.messages.length - 1].sender === "user";

  useEffect(() => {
    if (!session || session.status === "resolved") return;
    const interval = setInterval(async () => {
      try {
        const gid = await guestId();
        const updated = await easex.support.get(session.id, gid);
        if (!open && updated.messages.length > session.messages.length) setUnread(true);
        setSession(updated);
      } catch {
        // stays on last known state — next poll tries again
      }
    }, POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status, session?.messages.length, open, user]);

  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

  useEffect(() => {
    if (open && view === "chat") requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [open, view, session?.messages.length, awaitingAssistant]);

  const openHistory = async () => {
    setView("history");
    setViewingPast(null);
    setHistoryLoading(true);
    try {
      const gid = await guestId();
      const all = await easex.support.list(gid);
      setHistory(all.filter((s) => s.id !== session?.id));
    } catch {
      setError("Couldn't load your past conversations.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const pickAttachment = async () => {
    const files = await pickMedia(false);
    if (files?.[0]) setPendingFile(files[0]);
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
      const gid = await guestId();
      const updated = await easex.support.sendMessage(session.id, { body: body || undefined, attachment, guestId: gid });
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
      const gid = await guestId();
      const updated = await easex.support.escalate(session.id, gid);
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
      return <Image source={{ uri: m.attachment_url }} style={styles.attachmentImage} resizeMode="cover" />;
    }
    return <Text style={styles.attachmentLink}>📎 {m.attachment_name || "Attachment"}</Text>;
  };

  const renderMessages = (s: SupportSession, showTyping: boolean) => (
    <>
      {s.messages.length === 0 ? (
        <Text style={styles.hint}>Ask about a transaction, your verification, or anything else.</Text>
      ) : (
        s.messages.map((m) => (
          <View key={m.id} style={[styles.bubbleMsg, m.sender === "user" ? styles.bubbleMsgUser : styles.bubbleMsgOther]}>
            {m.sender === "admin" && (
              <Text style={styles.adminLabel}>{m.sender_admin_username ? `${m.sender_admin_username} · Agent` : "Agent"}</Text>
            )}
            {!!m.body && <Text style={styles.bubbleMsgText}>{m.body}</Text>}
            {renderAttachment(m)}
          </View>
        ))
      )}
      {showTyping && <TypingDots />}
    </>
  );

  return (
    <>
      <TouchableOpacity
        style={[styles.bubble, { bottom: 20 + insets.bottom }]}
        onPress={() => setOpen(true)}
        accessibilityLabel="Open EaseX Assistant"
        activeOpacity={0.85}
      >
        <Text style={styles.bubbleIcon}>💬</Text>
        {unread && <View style={styles.badge} />}
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { height: sheetHeight, marginBottom: keyboardHeight }]}>
            <View style={styles.header}>
              <View>
                <Text style={styles.headerTitle}>
                  {view === "history" ? (
                    viewingPast ? (
                      "Past conversation"
                    ) : (
                      "History"
                    )
                  ) : (
                    <>
                      Ease<Text style={{ color: colors.gold }}>X</Text> Assistant
                    </>
                  )}
                </Text>
                {view === "chat" && session && session.status !== "resolved" && (
                  <Text style={styles.headerSub}>{STATUS_LABEL[session.status] ?? session.status}</Text>
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                {view === "chat" ? (
                  <TouchableOpacity onPress={openHistory} accessibilityLabel="View past conversations">
                    <Text style={styles.historyIcon}>🕐</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => (viewingPast ? setViewingPast(null) : setView("chat"))}>
                    <Text style={styles.backText}>Back</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setOpen(false)} accessibilityLabel="Close support chat">
                  <Text style={styles.closeIcon}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {!user && view === "chat" && (
              <Text style={styles.guestHint}>Chatting as a guest — sign in to keep this conversation with your account.</Text>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            {view === "history" ? (
              <ScrollView style={styles.messages} contentContainerStyle={{ padding: 12 }}>
                {viewingPast ? (
                  <View style={{ gap: 8 }}>{renderMessages(viewingPast, false)}</View>
                ) : historyLoading ? (
                  <Text style={styles.hint}>Loading…</Text>
                ) : !history || history.length === 0 ? (
                  <Text style={styles.hint}>No past conversations yet.</Text>
                ) : (
                  history
                    .slice()
                    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                    .map((s) => (
                      <TouchableOpacity key={s.id} style={styles.historyRow} onPress={() => setViewingPast(s)}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={styles.historyTitle}>{s.subject || "Conversation"}</Text>
                          <Text style={styles.historyTime}>{timeAgo(s.updated_at)}</Text>
                        </View>
                        {s.messages.length > 0 && (
                          <Text style={styles.historyPreview} numberOfLines={1}>
                            {s.messages[s.messages.length - 1].body || "Sent an attachment"}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ))
                )}
              </ScrollView>
            ) : (
              <>
                <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={{ padding: 12, gap: 8 }}>
                  {loading ? (
                    <Text style={styles.hint}>Loading…</Text>
                  ) : !session ? (
                    <Text style={styles.hint}>Support isn't available right now — please try again shortly.</Text>
                  ) : (
                    renderMessages(session, awaitingAssistant)
                  )}
                </ScrollView>

                {session && session.status === "bot_active" && (
                  <TouchableOpacity style={styles.humanBtn} onPress={talkToHuman} disabled={sending}>
                    <Text style={styles.humanBtnText}>Speak to an Agent.</Text>
                  </TouchableOpacity>
                )}

                {session && (
                  <View style={[styles.inputArea, { paddingBottom: 12 + (keyboardHeight > 0 ? 0 : insets.bottom) }]}>
                    {pendingFile && (
                      <View style={styles.pendingRow}>
                        <Text style={styles.pendingText} numberOfLines={1}>
                          📎 {pendingFile.name}
                        </Text>
                        <TouchableOpacity onPress={() => setPendingFile(null)}>
                          <Text style={styles.closeIcon}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.inputRow}>
                      <TouchableOpacity onPress={pickAttachment} disabled={sending} accessibilityLabel="Attach a photo or video">
                        <Text style={styles.attachIcon}>📎</Text>
                      </TouchableOpacity>
                      <TextInput
                        value={text}
                        onChangeText={setText}
                        placeholder={session.status === "resolved" ? "Send a message to start a new chat…" : "Type a message…"}
                        style={styles.input}
                        editable={!sending}
                        onSubmitEditing={send}
                        returnKeyType="send"
                      />
                      <TouchableOpacity
                        style={[styles.sendBtn, sending || (!text.trim() && !pendingFile) ? styles.sendBtnDisabled : null]}
                        onPress={send}
                        disabled={sending || (!text.trim() && !pendingFile)}
                      >
                        <Text style={styles.sendBtnText}>Send</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 1000,
  },
  bubbleIcon: { fontSize: 24 },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.paperRaised,
  },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: {
    backgroundColor: colors.paperRaised,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerTitle: { fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink },
  headerSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  historyIcon: { fontSize: 16 },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.gold },
  closeIcon: { fontSize: 18, color: colors.inkSoft, padding: 4 },
  guestHint: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.inkSoft, marginHorizontal: 14, marginTop: 8 },
  error: { color: colors.danger, fontSize: 13, marginHorizontal: 14, marginTop: 8 },
  hint: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
  messages: { flex: 1 },
  bubbleMsg: { maxWidth: "85%", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  bubbleMsgUser: { alignSelf: "flex-end", backgroundColor: colors.gold },
  bubbleMsgOther: { alignSelf: "flex-start", backgroundColor: colors.paper },
  bubbleMsgText: { fontFamily: fonts.bodyRegular, fontSize: 13.5, color: colors.ink },
  adminLabel: { fontFamily: fonts.bodyMedium, fontSize: 10.5, color: colors.inkSoft, marginBottom: 2 },
  attachmentImage: { width: 180, height: 130, borderRadius: 8, marginTop: 6 },
  attachmentLink: { fontFamily: fonts.bodyRegular, fontSize: 12.5, color: colors.ink, textDecorationLine: "underline", marginTop: 6 },
  humanBtn: { marginHorizontal: 12, marginBottom: 8, paddingVertical: 6, paddingHorizontal: 10 },
  humanBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.indigo, textDecorationLine: "underline" },
  inputArea: { borderTopWidth: 1, borderTopColor: colors.line, padding: 12 },
  pendingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.paper,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  pendingText: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.ink, flex: 1 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  attachIcon: { fontSize: 18, paddingHorizontal: 2 },
  input: {
    flex: 1,
    fontFamily: fonts.bodyRegular,
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.ink,
  },
  sendBtn: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  typingRow: { flexDirection: "row", gap: 3, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 10 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.inkSoft },
  historyRow: { backgroundColor: colors.paper, borderRadius: 8, padding: 10, marginBottom: 6 },
  historyTitle: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  historyTime: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.inkSoft },
  historyPreview: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
});

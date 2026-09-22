import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import type { AdminSupportSession, SupportSessionStatus } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";
import FilterChips from "../../components/FilterChips";

const FILTERS = [
  { value: "escalated", label: "Waiting" },
  { value: "admin_active", label: "Handled" },
  { value: "bot_active", label: "Assistant" },
  { value: "resolved", label: "Resolved" },
  { value: "", label: "All" },
];

const REASON_LABELS: Record<string, string> = {
  user_requested: "Asked for a human",
  restricted_intent: "Sensitive topic",
  low_confidence: "Assistant couldn't help",
  manual: "Escalated by staff",
};

/**
 * Web shows list + detail side by side; on a phone that doesn't fit, so
 * this is a single screen that toggles between the list and an open
 * conversation (back button returns to the list) — same data, same
 * actions, laid out for one column instead of two.
 */
export default function AdminSupportQueueScreen() {
  const [sessions, setSessions] = useState<AdminSupportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<SupportSessionStatus | "">("escalated");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(() => {
    easex.admin.support
      .list(statusFilter || undefined)
      .then(setSessions)
      .catch(() => setError("Couldn't load the queue."))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  const open = sessions.find((s) => s.id === openId) ?? null;

  useEffect(() => {
    if (open) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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

  if (open) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setOpenId(null)}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle}>{open.username}</Text>
          <View style={{ width: 50 }} />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
          {open.messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.sender === "user" ? styles.bubbleUser : styles.bubbleOther]}>
              {m.sender === "admin" && m.sender_admin_username && (
                <Text style={styles.bubbleAuthor}>{m.sender_admin_username}</Text>
              )}
              <Text style={styles.bubbleText}>{m.body}</Text>
            </View>
          ))}
        </ScrollView>

        {open.status === "admin_active" ? (
          <View style={styles.replyRow}>
            <TextInput
              style={styles.replyInput}
              value={reply}
              onChangeText={setReply}
              placeholder="Reply…"
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={send} disabled={busyId === open.id}>
              <Text style={styles.primaryBtnText}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dangerBtn} onPress={resolve} disabled={busyId === open.id}>
              <Text style={styles.dangerBtnText}>Resolve</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.hintFooter}>
            {open.status === "escalated" ? "Claim this session to reply." : "This session isn't with an agent."}
          </Text>
        )}
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <FilterChips options={FILTERS} value={statusFilter} onChange={(v) => setStatusFilter(v as SupportSessionStatus | "")} />

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : sessions.length === 0 ? (
        <Text style={styles.muted}>Nothing here.</Text>
      ) : (
        sessions.map((s) => (
          <TouchableOpacity key={s.id} style={styles.card} onPress={() => setOpenId(s.id)}>
            <View style={styles.cardHeader}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.cardTitle}>{s.username}</Text>
                <Text style={styles.cardSub}>
                  {s.subject || "General enquiry"}
                  {s.escalation_reason ? ` · ${REASON_LABELS[s.escalation_reason] ?? s.escalation_reason}` : ""}
                </Text>
              </View>
              <Text style={styles.cardMeta}>{s.assigned_admin_username ?? "Unclaimed"}</Text>
            </View>
            {s.status === "escalated" && (
              <TouchableOpacity
                style={styles.primaryBtn}
                disabled={busyId === s.id}
                onPress={(e) => {
                  e.stopPropagation?.();
                  claim(s.id);
                }}
              >
                <Text style={styles.primaryBtnText}>Claim</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 16, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginHorizontal: 16, marginTop: 8 },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 16,
    backgroundColor: colors.paperRaised,
    marginBottom: 14,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  cardMeta: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.inkSoft },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16, alignSelf: "flex-start" },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#17130A" },
  dangerBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16 },
  dangerBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  backText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.gold, width: 60 },
  detailTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  bubble: { maxWidth: "85%", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  bubbleUser: { alignSelf: "flex-start", backgroundColor: colors.paperRaised },
  bubbleOther: { alignSelf: "flex-end", backgroundColor: colors.gold },
  bubbleAuthor: { fontFamily: fonts.bodyMedium, fontSize: 10.5, color: colors.inkSoft, marginBottom: 2 },
  bubbleText: { fontFamily: fonts.bodyRegular, fontSize: 13.5, color: colors.ink },
  replyRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.line, alignItems: "center" },
  replyInput: {
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
  hintFooter: { fontFamily: fonts.bodyRegular, fontSize: 12.5, color: colors.inkSoft, padding: 12, textAlign: "center" },
});

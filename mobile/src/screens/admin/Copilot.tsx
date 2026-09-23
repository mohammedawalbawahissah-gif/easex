import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import type { CopilotMessage } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";
import { useKeyboardHeight } from "../../lib/useKeyboardHeight";

export default function AdminCopilotScreen() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyboardHeight = useKeyboardHeight();

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
    <View style={styles.screen}>
      <Text style={styles.hint}>
        Ask about flags, transactions, or the review queues. Read-only — it can't approve, reject, or change
        anything, and nothing here is saved once you leave the screen.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
        {messages.length === 0 ? (
          <Text style={styles.muted}>Ask a question to get started.</Text>
        ) : (
          messages.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleOther]}>
              <Text style={styles.bubbleText}>{m.content}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.inputRow, { marginBottom: keyboardHeight }]}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Ask the copilot…"
          onSubmitEditing={ask}
          returnKeyType="send"
          editable={!busy}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={ask} disabled={busy || !text.trim()}>
          <Text style={styles.sendBtnText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  hint: { fontFamily: fonts.bodyRegular, fontSize: 12.5, color: colors.inkSoft, padding: 16, paddingBottom: 0 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginHorizontal: 16, marginTop: 8 },
  bubble: { maxWidth: "85%", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.gold },
  bubbleOther: { alignSelf: "flex-start", backgroundColor: colors.paperRaised },
  bubbleText: { fontFamily: fonts.bodyRegular, fontSize: 13.5, color: colors.ink },
  inputRow: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.line },
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
  sendBtn: { backgroundColor: colors.gold, borderRadius: 8, paddingHorizontal: 16, justifyContent: "center" },
  sendBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#17130A" },
});

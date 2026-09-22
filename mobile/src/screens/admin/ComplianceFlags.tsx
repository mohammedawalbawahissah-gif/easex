import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import type { ComplianceFlag } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";
import StatusPill from "../../components/StatusPill";
import FilterChips from "../../components/FilterChips";

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "reviewing", label: "Reviewing" },
  { value: "cleared", label: "Cleared" },
  { value: "escalated", label: "Escalated" },
  { value: "", label: "All" },
];

export default function AdminComplianceFlagsScreen() {
  const [flags, setFlags] = useState<ComplianceFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    easex.admin.complianceFlags
      .list((statusFilter || undefined) as ComplianceFlag["status"] | undefined)
      .then(setFlags)
      .catch(() => setError("Couldn't load flags."))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(load, [load]);

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <FilterChips options={FILTERS} value={statusFilter} onChange={setStatusFilter} />

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : flags.length === 0 ? (
        <Text style={styles.muted}>Nothing here.</Text>
      ) : (
        flags.map((f) => (
          <View key={f.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.cardTitle}>{f.reason.replace("_", " ")}</Text>
                <Text style={styles.cardSub}>{f.username}</Text>
              </View>
              <StatusPill status={f.status} />
            </View>

            {!!f.notes && <Text style={styles.notesText}>{f.notes}</Text>}

            {(f.status === "open" || f.status === "reviewing") && (
              <View style={styles.actions}>
                <TextInput
                  style={styles.input}
                  placeholder="Resolution notes"
                  value={notes[f.id] ?? ""}
                  onChangeText={(v) => setNotes((prev) => ({ ...prev, [f.id]: v }))}
                />
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => resolve(f.id, "cleared")}
                    disabled={busyId === f.id}
                  >
                    <Text style={styles.primaryBtnText}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dangerBtn}
                    onPress={() => resolve(f.id, "escalated")}
                    disabled={busyId === f.id}
                  >
                    <Text style={styles.dangerBtnText}>Escalate</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 16, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginBottom: 12 },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 16,
    backgroundColor: colors.paperRaised,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, textTransform: "capitalize" },
  cardSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  notesText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.ink, marginBottom: 10 },
  actions: { gap: 8 },
  actionRow: { flexDirection: "row", gap: 8 },
  input: {
    fontFamily: fonts.bodyRegular,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    padding: 10,
    backgroundColor: colors.paper,
  },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16 },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#17130A" },
  dangerBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16 },
  dangerBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },
});

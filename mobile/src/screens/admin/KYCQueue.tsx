import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, StyleSheet } from "react-native";
import type { AdminKYCSubmission } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";
import StatusPill from "../../components/StatusPill";
import FilterChips from "../../components/FilterChips";
import KYCAssessmentPanel from "../../components/admin/KYCAssessmentPanel";

const FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "All" },
];

export default function AdminKYCQueueScreen() {
  const [submissions, setSubmissions] = useState<AdminKYCSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    easex.admin.kyc
      .list(statusFilter || undefined)
      .then(setSubmissions)
      .catch(() => setError("Couldn't load submissions."))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(load, [load]);

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
      setRejectingId(null);
      setRejectReason("");
      load();
    } catch {
      setError("Couldn't reject — please try again.");
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
      ) : submissions.length === 0 ? (
        <Text style={styles.muted}>Nothing here.</Text>
      ) : (
        submissions.map((s) => (
          <View key={s.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.cardTitle}>{s.full_name}</Text>
                <Text style={styles.cardSub}>
                  {s.username} · currently {s.current_tier}
                </Text>
              </View>
              <StatusPill status={s.status} />
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>ID type</Text>
              <Text style={styles.fieldValue}>{s.id_type.replace("_", " ")}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>ID number</Text>
              <Text style={styles.fieldValue}>{s.id_number}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Date of birth</Text>
              <Text style={styles.fieldValue}>{s.date_of_birth}</Text>
            </View>

            <View style={styles.imageRow}>
              <Image source={{ uri: s.id_document_front }} style={styles.evidenceImage} />
              {s.id_document_back && <Image source={{ uri: s.id_document_back }} style={styles.evidenceImage} />}
              <Image source={{ uri: s.selfie }} style={styles.evidenceImage} />
            </View>

            <KYCAssessmentPanel submissionId={s.id} />

            {s.status === "rejected" && !!s.rejection_reason && (
              <Text style={styles.rejectionText}>Reason: {s.rejection_reason}</Text>
            )}

            {s.status === "pending" && (
              <View style={styles.actions}>
                {rejectingId === s.id ? (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Rejection reason (shown to the user)"
                      value={rejectReason}
                      onChangeText={setRejectReason}
                    />
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={() => submitReject(s.id)}
                        disabled={busyId === s.id}
                      >
                        <Text style={styles.primaryBtnText}>Confirm reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRejectingId(null)}>
                        <Text style={styles.secondaryBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.primaryBtn} onPress={() => approve(s.id)} disabled={busyId === s.id}>
                      <Text style={styles.primaryBtnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.dangerBtn}
                      onPress={() => setRejectingId(s.id)}
                      disabled={busyId === s.id}
                    >
                      <Text style={styles.dangerBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  fieldLabel: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, textTransform: "capitalize" },
  fieldValue: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  imageRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 10 },
  evidenceImage: { width: 90, height: 68, borderRadius: 6, borderWidth: 1, borderColor: colors.line },
  rejectionText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.danger, marginBottom: 8 },
  actions: { marginTop: 6, gap: 8 },
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
  secondaryBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16 },
  secondaryBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  dangerBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16 },
  dangerBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },
});

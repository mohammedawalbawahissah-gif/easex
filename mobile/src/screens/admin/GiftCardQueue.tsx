import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet, TextInput } from "react-native";
import type { AdminGiftCardSubmission } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";
import StatusPill from "../../components/StatusPill";
import FilterChips from "../../components/FilterChips";
import GiftCardAssessmentPanel from "../../components/admin/GiftCardAssessmentPanel";

const FILTERS = [
  { value: "under_review", label: "Under review" },
  { value: "verified", label: "Approved" },
  { value: "settled", label: "Settled" },
  { value: "rejected", label: "Rejected" },
  { value: "flagged", label: "Flagged" },
  { value: "", label: "All" },
];

/** Mirrors the server's rule: payout = redeemed value x rate, rounded DOWN to the cent. */
function previewPayout(redeemed: string, rate: string): string | null {
  const v = Number(redeemed);
  if (!Number.isFinite(v) || v <= 0) return null;
  return (Math.floor(v * Number(rate) * 100 + 1e-9) / 100).toFixed(2);
}

function autoPaymentSummary(s: AdminGiftCardSubmission): string | null {
  const a = s.auto_payment;
  if (!a) return null;
  if (!a.auto_settled) return a.manual_reason ?? "Auto-payment was off — settle manually.";
  if (a.auto_payout?.status === "sent") return "Credited to the wallet and sent on to their mobile money.";
  if (a.auto_payout && a.auto_payout.reason && a.auto_payout.reason !== "seller has not opted in") {
    return `Credited to the wallet automatically. Not sent to mobile money: ${a.auto_payout.reason}.`;
  }
  return "Credited to the seller's wallet automatically.";
}

export default function AdminGiftCardQueueScreen() {
  const [submissions, setSubmissions] = useState<AdminGiftCardSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("under_review");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState<boolean | null>(null);

  // Card-code reveal: which card is asking for a 2FA code, and the code currently on screen (auto-hides).
  const [revealAskId, setRevealAskId] = useState<string | null>(null);
  const [revealOtp, setRevealOtp] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; code: string; left: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = () => {
    if (hideTimer.current) clearInterval(hideTimer.current);
    hideTimer.current = null;
  };
  // Never leave a code on screen after navigating away.
  useEffect(() => stopTimer, []);

  const reveal = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await easex.admin.giftcards.revealCode(id, revealOtp.trim());
      setRevealAskId(null);
      setRevealOtp("");
      setRevealed({ id, code: r.code, left: r.hide_after_seconds });
      stopTimer();
      hideTimer.current = setInterval(() => {
        setRevealed((cur) => {
          if (!cur || cur.left <= 1) {
            stopTimer();
            return null;
          }
          return { ...cur, left: cur.left - 1 };
        });
      }, 1000);
      load(); // refreshes the reveal count
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't reveal the code."));
    } finally {
      setBusyId(null);
    }
  };

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState("");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    easex.admin.giftcards
      .list({ status: statusFilter || undefined })
      .then(setSubmissions)
      .catch(() => setError("Couldn't load submissions."))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(load, [load]);
  useEffect(() => {
    easex.admin.dashboard().then((d) => setAutoOn(d.giftcard_auto_payment_enabled)).catch(() => {});
  }, []);

  const runAction = async (fn: () => Promise<unknown>, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      setApprovingId(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Action failed — please try again."));
    } finally {
      setBusyId(null);
    }
  };

  const openApprove = (s: AdminGiftCardSubmission) => {
    setApprovingId(s.id);
    setRedeemed(s.face_value);
    setReference("");
    setConfirmed(false);
    setError(null);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <FilterChips options={FILTERS} value={statusFilter} onChange={setStatusFilter} />

      {autoOn !== null && (
        <Text style={styles.hint}>
          {autoOn
            ? "Auto-payment is ON: approving a card credits the seller's wallet immediately (and pays out to mobile money for sellers who opted in)."
            : "Auto-payment is OFF: after approving, use “Settle” to pay the seller."}
        </Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : submissions.length === 0 ? (
        <Text style={styles.muted}>Nothing here.</Text>
      ) : (
        submissions.map((s) => {
          const payout = previewPayout(redeemed, s.offered_rate);
          const summary = autoPaymentSummary(s);
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.cardTitle}>{s.brand_name}{s.subcategory_name ? ` — ${s.subcategory_name}` : ""}</Text>
                  <Text style={styles.cardSub}>{s.username}</Text>
                </View>
                <StatusPill status={s.transaction_status} />
              </View>

              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Declared value</Text>
                <Text style={styles.fieldValue}>{s.face_value} {s.card_currency}</Text>
              </View>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Rate</Text>
                <Text style={styles.fieldValue}>GHS {Number(s.offered_rate)} per 1 {s.card_currency}</Text>
              </View>
              {s.redeemed_value && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Redeemed</Text>
                  <Text style={styles.fieldValue}>{s.redeemed_value} {s.card_currency}{s.redemption_reference ? ` · ${s.redemption_reference}` : ""}</Text>
                </View>
              )}
              {s.verified_value && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Payout amount</Text>
                  <Text style={styles.fieldValue}>GHS {s.verified_value}</Text>
                </View>
              )}

              {s.card_image && <Image source={{ uri: s.card_image }} style={styles.evidenceImage} />}
              <GiftCardAssessmentPanel submissionId={s.id} />
              {!!s.subcategory_help && <Text style={styles.hint}>{s.subcategory_help}</Text>}

              {s.code_available && (s.transaction_status === "under_review" || s.transaction_status === "flagged") && (
                <View style={styles.approveForm}>
                  {revealed?.id === s.id ? (
                    <View>
                      <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: 6, padding: 12, backgroundColor: colors.paper }}>
                        <Text selectable style={{ fontFamily: fonts.monoSemiBold, fontSize: 15, color: colors.ink }}>{revealed.code}</Text>
                      </View>
                      <Text style={styles.hint}>Hides in {revealed.left}s. This view was logged.</Text>
                    </View>
                  ) : revealAskId === s.id ? (
                    <View>
                      <Text style={styles.label}>Fresh authenticator code</Text>
                      <TextInput style={styles.input} value={revealOtp} onChangeText={(v) => setRevealOtp(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" autoFocus />
                      <Text style={styles.hint}>If you just signed in, wait for the next code — each code works once.</Text>
                      <View style={styles.actionRow}>
                        <TouchableOpacity style={[styles.primaryBtn, (busyId === s.id || revealOtp.length !== 6) && { opacity: 0.5 }]} disabled={busyId === s.id || revealOtp.length !== 6} onPress={() => reveal(s.id)}>
                          <Text style={styles.primaryBtnText}>Reveal</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setRevealAskId(null); setRevealOtp(""); }}>
                          <Text style={styles.secondaryBtnText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setRevealAskId(s.id); setRevealOtp(""); setError(null); }}>
                      <Text style={styles.secondaryBtnText}>Reveal card code{s.code_reveal_count ? ` (viewed ${s.code_reveal_count}×)` : ""}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {!!s.reviewer_notes && <Text style={styles.rejectionText}>Notes: {s.reviewer_notes}</Text>}
              {!!summary && <Text style={styles.hint}>{summary}</Text>}

              {s.transaction_status === "under_review" && approvingId !== s.id && (
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => openApprove(s)} disabled={busyId === s.id}>
                    <Text style={styles.primaryBtnText}>Approve…</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerBtn} onPress={() => runAction(() => easex.admin.giftcards.reject(s.id), s.id)} disabled={busyId === s.id}>
                    <Text style={styles.dangerBtnText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => runAction(() => easex.admin.giftcards.flag(s.id, "Flagged for compliance review"), s.id)} disabled={busyId === s.id}>
                    <Text style={styles.secondaryBtnText}>Flag</Text>
                  </TouchableOpacity>
                </View>
              )}

              {approvingId === s.id && (
                <View style={styles.approveForm}>
                  <Text style={styles.label}>Amount actually redeemed from the card ({s.card_currency})</Text>
                  <TextInput style={styles.input} value={redeemed} onChangeText={setRedeemed} keyboardType="decimal-pad" />
                  <Text style={styles.label}>Redemption reference (order / receipt no.)</Text>
                  <TextInput style={styles.input} value={reference} onChangeText={setReference} autoCapitalize="none" />
                  <TouchableOpacity style={styles.checkRow} onPress={() => setConfirmed((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}>
                    <View style={[styles.checkbox, confirmed && styles.checkboxOn]}>{confirmed && <Text style={styles.checkMark}>✓</Text>}</View>
                    <Text style={styles.checkText}>I have redeemed this card and the amount above is what it was worth.</Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>
                    {payout ? `Seller will be paid GHS ${payout}${autoOn ? " — immediately." : " once you settle."}` : "Enter the redeemed amount."}
                  </Text>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.primaryBtn, (!confirmed || !payout || busyId === s.id) && { opacity: 0.5 }]}
                      disabled={!confirmed || !payout || busyId === s.id}
                      onPress={() =>
                        runAction(
                          () => easex.admin.giftcards.approve(s.id, { redeemed_confirmed: true, redeemed_value: redeemed.trim(), redemption_reference: reference.trim() }),
                          s.id
                        )
                      }
                    >
                      <Text style={styles.primaryBtnText}>Approve{autoOn ? " & pay" : ""}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setApprovingId(null)}>
                      <Text style={styles.secondaryBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {s.transaction_status === "verified" && (
                <TouchableOpacity style={styles.primaryBtn} onPress={() => runAction(() => easex.admin.transactions.settle(s.transaction), s.id)} disabled={busyId === s.id}>
                  <Text style={styles.primaryBtnText}>Settle — credit seller's wallet</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 16, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  hint: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft, marginVertical: 8 },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginBottom: 12 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 16, backgroundColor: colors.paperRaised, marginBottom: 14 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, textTransform: "capitalize" },
  cardSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  fieldLabel: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft },
  fieldValue: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  evidenceImage: { width: 110, height: 82, borderRadius: 6, borderWidth: 1, borderColor: colors.line, marginTop: 10, marginBottom: 6 },
  rejectionText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.danger, marginTop: 4, marginBottom: 8 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  approveForm: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 12, paddingTop: 12 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.inkSoft, marginBottom: 4, marginTop: 8 },
  input: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 9, paddingHorizontal: 10 },
  checkRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 12 },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: colors.inkSoft, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkMark: { color: colors.paper, fontSize: 13 },
  checkText: { flex: 1, fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.ink },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16, marginTop: 10 },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: "#17130A" },
  secondaryBtn: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16, marginTop: 10 },
  secondaryBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  dangerBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 16, marginTop: 10 },
  dangerBtnText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.danger },
});

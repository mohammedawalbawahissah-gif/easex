import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { KYCAssessment } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";

const FACE_LABELS: Record<string, string> = {
  likely_match: "Likely the same person",
  uncertain: "Uncertain",
  likely_mismatch: "Possible mismatch",
  not_assessed: "Not assessed",
};

/** Renders nothing while there's no assessment yet — a hint alongside the human review, never a blocker. */
export default function KYCAssessmentPanel({ submissionId }: { submissionId: string }) {
  const [assessment, setAssessment] = useState<KYCAssessment | null>(null);

  useEffect(() => {
    let active = true;
    easex.admin.risk
      .kycAssessment(submissionId)
      .then((a) => active && setAssessment(a))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [submissionId]);

  if (!assessment) return null;

  const nameFlag = assessment.name_matches === false;
  const dobFlag = assessment.dob_matches === false;
  const faceFlag = assessment.face_impression === "likely_mismatch";
  const anyFlag = nameFlag || dobFlag || faceFlag;

  return (
    <View style={[styles.box, anyFlag && styles.boxFlagged]}>
      <Text style={styles.title}>AI pre-check — not authoritative, for your review only</Text>
      <Text style={styles.line}>
        Name on ID: {assessment.extracted_full_name || "unclear"}
        {nameFlag && "  ⚠️ doesn't match what was entered"}
      </Text>
      <Text style={styles.line}>
        DOB on ID: {assessment.extracted_date_of_birth || "unclear"}
        {dobFlag && "  ⚠️ doesn't match what was entered"}
      </Text>
      <Text style={styles.line}>
        Selfie vs. ID photo: {FACE_LABELS[assessment.face_impression]}
        {faceFlag && "  ⚠️"}
      </Text>
      {!!assessment.notes && <Text style={styles.notes}>{assessment.notes}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: 8, padding: 10, marginTop: 8, gap: 3 },
  boxFlagged: { backgroundColor: "#FFF3CD" },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 11.5, color: colors.inkSoft, marginBottom: 2 },
  line: { fontFamily: fonts.bodyRegular, fontSize: 12.5, color: colors.ink },
  notes: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, fontStyle: "italic", marginTop: 4 },
});

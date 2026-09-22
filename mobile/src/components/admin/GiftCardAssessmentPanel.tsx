import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { GiftCardAssessment } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";

const CONSISTENCY_LABELS: Record<string, string> = {
  consistent: "Matches what was declared",
  mismatch: "Doesn't match what was declared",
  unreadable: "Couldn't read the image",
  not_assessed: "Not assessed",
};

/** Renders nothing if no card_image was submitted or no assessment exists yet. */
export default function GiftCardAssessmentPanel({ submissionId }: { submissionId: string }) {
  const [assessment, setAssessment] = useState<GiftCardAssessment | null>(null);

  useEffect(() => {
    let active = true;
    easex.admin.risk
      .giftcardAssessment(submissionId)
      .then((a) => active && setAssessment(a))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [submissionId]);

  if (!assessment) return null;

  const flagged = assessment.consistency === "mismatch";

  return (
    <View style={[styles.box, flagged && styles.boxFlagged]}>
      <Text style={styles.title}>AI pre-check — not authoritative, for your review only</Text>
      <Text style={styles.line}>
        Read off the card: {assessment.detected_brand || "unclear"}
        {assessment.detected_value_text ? ` · ${assessment.detected_value_text}` : ""}
      </Text>
      <Text style={styles.line}>
        {CONSISTENCY_LABELS[assessment.consistency]}
        {flagged && "  ⚠️"}
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

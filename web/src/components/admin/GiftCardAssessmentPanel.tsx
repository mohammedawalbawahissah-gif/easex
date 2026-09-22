import { useEffect, useState } from "react";
import type { GiftCardAssessment } from "@easex/shared";
import { easex } from "../../lib/easexClient";

const CONSISTENCY_LABELS: Record<string, string> = {
  consistent: "Matches what was declared",
  mismatch: "Doesn't match what was declared",
  unreadable: "Couldn't read the image",
  not_assessed: "Not assessed",
};

/**
 * Drop this inside the existing submission card in GiftCardQueue.tsx, near
 * the declared brand/value:
 *   <GiftCardAssessmentPanel submissionId={s.id} />
 *
 * Renders nothing if no card_image was submitted or no assessment exists
 * yet — same "silent unless there's something to say" contract as
 * KYCAssessmentPanel.
 */
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
    <div
      className="hint"
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 6,
        background: flagged ? "var(--warn-bg, #fff3cd)" : "var(--surface-2, #f5f5f5)",
      }}
    >
      <strong>AI pre-check</strong> — not authoritative, for your review only
      <div>
        Read off the card: {assessment.detected_brand || "unclear"}
        {assessment.detected_value_text && ` · ${assessment.detected_value_text}`}
      </div>
      <div>
        {CONSISTENCY_LABELS[assessment.consistency]}
        {flagged && " ⚠️"}
      </div>
      {assessment.notes && <div style={{ marginTop: 4, fontStyle: "italic" }}>{assessment.notes}</div>}
    </div>
  );
}

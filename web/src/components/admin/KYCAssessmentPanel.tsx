import { useEffect, useState } from "react";
import type { KYCAssessment } from "@easex/shared";
import { easex } from "../../lib/easexClient";

const FACE_LABELS: Record<string, string> = {
  likely_match: "Likely the same person",
  uncertain: "Uncertain",
  likely_mismatch: "Possible mismatch",
  not_assessed: "Not assessed",
};

/**
 * Drop this inside the existing submission card in KYCQueue.tsx, near
 * where the applicant's declared name/DOB are shown:
 *   <KYCAssessmentPanel submissionId={s.id} />
 *
 * Renders nothing while there's no assessment yet (still running, assist
 * disabled, or the fetch failed) — this is always a hint alongside the
 * human review, never a blocker or a required step, so silence is the
 * correct fallback, not an error state.
 */
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
    <div
      className="hint"
      style={{
        marginTop: 8,
        padding: 8,
        borderRadius: 6,
        background: anyFlag ? "var(--warn-bg, #fff3cd)" : "var(--surface-2, #f5f5f5)",
      }}
    >
      <strong>AI pre-check</strong> — not authoritative, for your review only
      <div>
        Name on ID: {assessment.extracted_full_name || "unclear"}
        {nameFlag && " ⚠️ doesn't match what was entered"}
      </div>
      <div>
        DOB on ID: {assessment.extracted_date_of_birth || "unclear"}
        {dobFlag && " ⚠️ doesn't match what was entered"}
      </div>
      <div>
        Selfie vs. ID photo: {FACE_LABELS[assessment.face_impression]}
        {faceFlag && " ⚠️"}
      </div>
      {assessment.notes && <div style={{ marginTop: 4, fontStyle: "italic" }}>{assessment.notes}</div>}
    </div>
  );
}

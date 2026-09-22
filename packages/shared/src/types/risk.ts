export type FaceImpression = "likely_match" | "uncertain" | "likely_mismatch" | "not_assessed";

export interface KYCAssessment {
  extracted_full_name: string;
  extracted_date_of_birth: string;
  name_matches: boolean | null;
  dob_matches: boolean | null;
  face_impression: FaceImpression;
  notes: string;
  assessed_at: string;
}

export type GiftCardConsistency = "consistent" | "mismatch" | "unreadable" | "not_assessed";

export interface GiftCardAssessment {
  detected_brand: string;
  detected_value_text: string;
  consistency: GiftCardConsistency;
  notes: string;
  assessed_at: string;
}

export interface ComplianceRiskSettings {
  velocity_detection_enabled: boolean;
  velocity_window_minutes: number;
  velocity_max_transactions: number;
  structuring_detection_enabled: boolean;
  structuring_window_hours: number;
  structuring_min_transaction_count: number;
  structuring_sum_threshold_ratio: string;
  kyc_assist_enabled: boolean;
  giftcard_assist_enabled: boolean;
  updated_at: string;
}

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

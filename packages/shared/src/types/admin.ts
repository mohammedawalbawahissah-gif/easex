import type { KYCIdType, KYCStatus } from "./kyc";
import type { GiftCardFormat, GiftCardGalleryItem } from "./giftcard";
import type { TransactionStatus, TransactionType } from "./transaction";
import type { Currency } from "./wallet";
import type { KYCTier } from "./user";

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  phone_number: string;
  kyc_tier: KYCTier;
  kyc_verified_at: string | null;
  is_flagged: boolean;
  is_staff: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AdminKYCSubmission {
  id: string;
  user: string;
  username: string;
  email: string;
  current_tier: KYCTier;
  full_name: string;
  date_of_birth: string;
  id_type: KYCIdType;
  id_number: string;
  id_document_front: string;
  id_document_back: string | null;
  selfie: string;
  status: KYCStatus;
  rejection_reason: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string;
}

export interface AdminGiftCardSubmission {
  id: string;
  user: string;
  username: string;
  email: string;
  /** Brand slug. Use brand_name for display. */
  brand: string;
  brand_name: string;
  subcategory: string | null;
  subcategory_name: string | null;
  /** ISO country code / "EU" / "GLOBAL" of the card type ("" for legacy submissions). */
  country: string;
  card_format: GiftCardFormat | "";
  subcategory_help: string;
  /** true while the code is stored (awaiting a decision) — a reveal is possible. Never the code itself. */
  code_available: boolean;
  code_reveal_count: number;
  code_wiped_at: string | null;
  /** Currency of face_value / redeemed_value. */
  card_currency: string;
  face_value: string;
  offered_rate: string;
  // GHS payout confirmed by the server (redeemed_value x offered_rate).
  verified_value: string | null;
  // What the reviewer actually redeemed from the card.
  redeemed_value: string | null;
  redemption_reference: string;
  redeemed_at: string | null;
  card_image: string | null;
  gallery: GiftCardGalleryItem[];
  reviewer_notes: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  transaction: string;
  transaction_status: TransactionStatus;
  // What automatic payment did when this was approved (null if not approved yet).
  auto_payment: AutoPaymentOutcome | null;
}

export interface AutoPaymentOutcome {
  auto_settled: boolean;
  auto_payout: { status: "sent" | "skipped"; reason: string; transaction: string | null } | null;
  /** Set when auto-payment is on but this card type is manual-only (open-loop prepaid cards). */
  manual_reason?: string;
}

export interface ApproveGiftCardPayload {
  /** The reviewer's attestation that the card really was redeemed. Must be true. */
  redeemed_confirmed: boolean;
  /** Amount actually redeemed, in the card's own value units. */
  redeemed_value: string;
  redemption_reference?: string;
  reviewer_notes?: string;
}

export interface AdminTransaction {
  id: string;
  user: string;
  username: string;
  wallet: string;
  counter_wallet: string | null;
  transaction_type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: Currency;
  counter_currency: Currency | null;
  idempotency_key: string;
  external_reference: string;
  metadata: Record<string, unknown>;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ComplianceFlagReason = "structuring" | "duplicate_card" | "velocity" | "manual" | "other";
export type ComplianceFlagStatus = "open" | "reviewing" | "cleared" | "escalated";

export interface ComplianceFlag {
  id: string;
  user: string;
  username: string;
  transaction: string | null;
  reason: ComplianceFlagReason;
  status: ComplianceFlagStatus;
  notes: string;
  raised_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AdminDashboardStats {
  pending_kyc: number;
  giftcards_under_review: number;
  transactions_awaiting_settlement: number;
  withdrawals_awaiting_review: number;
  loads_awaiting_confirmation: number;
  giftcard_auto_payment_enabled: boolean;
  open_compliance_flags: number;
  total_users: number;
  users_by_tier: Record<KYCTier, number>;
}

import type { RNFilePart } from "./giftcard";

export type KYCIdType = "national_id" | "passport" | "voters_id" | "drivers_license";
export type KYCStatus = "pending" | "approved" | "rejected";

export interface KYCSubmission {
  id: string;
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  id_type: KYCIdType;
  id_number: string;
  id_document_front: string; // URL
  id_document_back: string | null; // URL
  selfie: string; // URL
  status: KYCStatus;
  rejection_reason: string;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface SubmitKYCPayload {
  full_name: string;
  date_of_birth: string;
  id_type: KYCIdType;
  id_number: string;
  id_document_front: File | Blob | RNFilePart;
  id_document_back?: File | Blob | RNFilePart;
  selfie: File | Blob | RNFilePart;
}

import type { TransactionStatus } from "./transaction";

export type CardBrand =
  | "amazon"
  | "apple"
  | "google_play"
  | "steam"
  | "walmart"
  | "other";

export interface GiftCardSubmission {
  id: string;
  brand: CardBrand;
  face_value: string;
  offered_rate: string;
  verified_value: string | null;
  card_image: string | null; // URL
  submitted_at: string;
  transaction: string; // transaction id
  transaction_status: TransactionStatus; // real status, from the linked Transaction
}

// React Native's FormData accepts {uri, name, type} objects instead of
// real File/Blob instances (which don't exist in that environment) —
// supporting both shapes lets one submit() function work on both platforms.
export interface RNFilePart {
  uri: string;
  name: string;
  type: string;
}

export interface SubmitGiftCardPayload {
  brand: CardBrand;
  card_code: string; // sent once, hashed server-side, never stored raw
  face_value: string;
  offered_rate: string;
  card_image?: File | Blob | RNFilePart | string;
}

import type { TransactionStatus } from "./transaction";

export type GiftCardCategory =
  | "shopping"
  | "gaming"
  | "apps_entertainment"
  | "fashion_beauty"
  | "food_travel"
  | "prepaid";

export type GiftCardFormat = "physical" | "ecode" | "any";

/** One specific kind of a brand's card: the issuing country/currency and format. */
export interface GiftCardSubcategory {
  id: string;
  slug: string;
  /** What the seller sees, e.g. "USA · E-code". */
  name: string;
  /** ISO country code, "EU" or "GLOBAL". */
  country: string;
  /** Currency the card is denominated in; the face value is entered in this. */
  currency: string;
  card_format: GiftCardFormat;
  min_value: string | null;
  max_value: string | null;
  /** GHS paid per 1 unit of `currency`. null = not priced yet. */
  rate: string | null;
  /** false when the subcategory has no rate: show it, but don't let it be chosen. */
  available: boolean;
  help_text: string;
}

export interface GiftCardBrand {
  slug: string;
  name: string;
  category: GiftCardCategory;
  category_label: string;
  color_from: string;
  color_to: string;
  subcategories: GiftCardSubcategory[];
}

export interface GiftCardCatalog {
  brands: GiftCardBrand[];
}

export interface GiftCardSubmission {
  id: string;
  /** Brand slug. Use brand_name for display. */
  brand: string;
  brand_name: string;
  /** null for submissions made before subcategories existed. */
  subcategory: string | null;
  subcategory_name: string | null;
  /** Currency of face_value (GHS for old submissions). */
  card_currency: string;
  face_value: string;
  /** GHS per 1 unit of card_currency, locked when submitted. */
  offered_rate: string;
  /** face_value x offered_rate, in GHS. */
  estimated_payout: string;
  verified_value: string | null;
  card_image: string | null; // URL
  /** Extra evidence beyond card_image — any number of images, a short video, or a PDF. */
  gallery: GiftCardGalleryItem[];
  submitted_at: string;
  transaction: string; // transaction id
  transaction_status: TransactionStatus; // real status, from the linked Transaction
}

export interface GiftCardGalleryItem {
  id: string;
  url: string;
  content_type: string;
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
  /** id of the chosen GiftCardSubcategory. Brand, currency and rate all follow from it. */
  subcategory: string;
  card_code: string; // sent once, hashed server-side, never stored raw
  /** In the subcategory's currency. */
  face_value: string;
  card_image?: File | Blob | RNFilePart | string;
  /** Up to 6 additional files — images, video, or PDF. */
  images?: (File | Blob | RNFilePart)[];
}

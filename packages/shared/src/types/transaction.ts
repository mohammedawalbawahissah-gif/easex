import type { Currency } from "./wallet";

export type TransactionType =
  | "crypto_deposit"
  | "crypto_trade"
  | "giftcard_sale"
  | "fiat_payout"
  | "wallet_load"
  | "crypto_withdrawal"
  | "transfer_out"
  | "transfer_in";

export type TransactionStatus =
  | "pending"
  | "under_review"
  | "verified"
  | "settled"
  | "rejected"
  | "flagged";

export interface Transaction {
  id: string;
  wallet: string; // wallet id
  transaction_type: TransactionType;
  status: TransactionStatus;
  amount: string; // decimal-as-string, see Wallet
  currency: Currency;
  idempotency_key: string;
  external_reference: string;
  // Present on two-sided moves (crypto trades): the currency paid
  // FROM, and (inside metadata.counter_amount) how much of it —
  // together with `amount`/`currency` this is enough to reconstruct
  // an accurate per-currency balance history client-side.
  // Type-specific extras, e.g. transfers carry `counterparty_username` and
  // `note`; wallet loads carry `reference` and (manual mode) `instructions`;
  // withdrawals carry `destination`.
  metadata: Record<string, unknown>;
  counter_currency: Currency | null;
  created_at: string;
  updated_at: string;
}

import type { TransactionStatus, TransactionType } from "../types/transaction";

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  crypto_deposit: "Crypto deposit",
  crypto_trade: "Crypto trade",
  giftcard_sale: "Gift card sale",
  fiat_payout: "Withdrawal",
  wallet_load: "Added money",
  crypto_withdrawal: "Crypto withdrawal",
  transfer_out: "Sent",
  transfer_in: "Received",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  verified: "Verified",
  settled: "Settled",
  rejected: "Rejected",
  flagged: "Flagged",
};

/** Sign shown next to an amount in a list: money out is "−", money in is "+". */
export function transactionDirection(type: TransactionType): "out" | "in" | "neutral" {
  if (type === "fiat_payout" || type === "crypto_withdrawal" || type === "transfer_out") return "out";
  if (type === "crypto_trade") return "neutral";
  return "in";
}

/** One-line description of a transaction for lists, using its metadata where it helps. */
export function transactionSubtitle(t: { transaction_type: TransactionType; metadata: Record<string, unknown> }): string | null {
  const who = t.metadata?.counterparty_username;
  if (typeof who === "string") {
    return t.transaction_type === "transfer_out" ? `To @${who}` : `From @${who}`;
  }
  return null;
}

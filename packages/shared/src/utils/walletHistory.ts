import type { Currency } from "../types/wallet";
import type { Transaction, TransactionType } from "../types/transaction";

/** Money leaving the wallet. Everything else that settles credits it. */
const DEBIT_TYPES: ReadonlySet<TransactionType> = new Set<TransactionType>([
  "fiat_payout",
  "crypto_withdrawal",
  "transfer_out",
]);

export interface BalancePoint {
  at: string; // ISO timestamp
  value: number;
}

/**
 * Reconstructs a running balance for one currency purely from the
 * settled transaction ledger — the same derivation the backend
 * itself uses to keep Wallet.balance in sync (see
 * apps/transactions/signals.py), so the result lands on the real
 * current balance as long as every settled transaction is included.
 *
 * Each transaction can touch a currency on either leg:
 *  - the "receiving" leg (transaction.currency, transaction.amount)
 *  - for two-sided moves like a crypto trade, the "paying" leg
 *    (transaction.counter_currency, metadata.counter_amount)
 */
export function buildBalanceHistory(transactions: Transaction[], currency: Currency): BalancePoint[] {
  const settled = transactions
    .filter((t) => t.status === "settled")
    .slice()
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());

  let running = 0;
  const points: BalancePoint[] = [];

  for (const t of settled) {
    let touched = false;

    if (t.currency === currency) {
      const amount = Number(t.amount);
      if (DEBIT_TYPES.has(t.transaction_type)) {
        running -= amount;
      } else {
        // crypto_deposit, wallet_load, transfer_in, giftcard_sale, and the
        // receiving leg of a crypto_trade all credit the wallet they're
        // recorded against.
        running += amount;
      }
      touched = true;
    }

    if (t.counter_currency === currency) {
      const counterAmount = Number((t.metadata?.["counter_amount"] as string | number | undefined) ?? 0);
      running -= counterAmount;
      touched = true;
    }

    if (touched) {
      points.push({ at: t.updated_at, value: running });
    }
  }

  return points;
}

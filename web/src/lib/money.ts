import type { Currency } from "@easex/shared";

/** Whole number of decimals a currency shows: 2 for GHS, up to 8 for crypto (trailing zeros trimmed). */
export function formatMoney(amount: string | number, currency: string): string {
  const n = Number(amount);
  if (currency === "GHS") {
    return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })}`;
}

export const CURRENCIES: Currency[] = ["GHS", "BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "XRP", "ADA", "DOGE", "LTC"];

export type Currency = "GHS" | "BTC" | "ETH" | "USDT" | "USDC" | "BNB" | "SOL" | "XRP" | "ADA" | "DOGE" | "LTC";

export interface Wallet {
  id: string;
  currency: Currency;
  // Amounts are transmitted as strings, never JS numbers — this
  // avoids floating point precision loss on decimal money values.
  // Parse with a decimal library (e.g. decimal.js) on the client
  // if you need to do arithmetic; never use parseFloat for display math.
  balance: string;
  escrow_balance: string;
  updated_at: string;
}

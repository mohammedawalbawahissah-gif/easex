export type TradableCurrency = "BTC" | "ETH" | "USDT" | "USDC" | "BNB" | "SOL" | "XRP" | "ADA" | "DOGE" | "LTC";

export interface ExchangeRate {
  currency: TradableCurrency;
  buy_rate: string;
  sell_rate: string;
  updated_at: string;
}

export interface ExchangeRateHistoryPoint {
  currency: TradableCurrency;
  buy_rate: string;
  sell_rate: string;
  recorded_at: string;
}

export type TradeDirection = "buy" | "sell";

export interface TradeRequestPayload {
  currency: TradableCurrency;
  direction: TradeDirection;
  amount: string; // always in the crypto currency's own units
}

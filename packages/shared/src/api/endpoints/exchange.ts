import type { ApiClient } from "../client";
import type {
  ExchangeRate,
  ExchangeRateHistoryPoint,
  TradableCurrency,
  TradeRequestPayload,
} from "../../types";
import type { Transaction } from "../../types";

export function exchangeEndpoints(client: ApiClient) {
  return {
    rates: () => client.get<ExchangeRate[]>("/api/exchange/rates/"),
    rateHistory: (currency?: TradableCurrency) =>
      client.get<ExchangeRateHistoryPoint[]>(
        currency ? `/api/exchange/rate-history/?currency=${currency}` : "/api/exchange/rate-history/"
      ),
    trade: (payload: TradeRequestPayload) =>
      client.post<Transaction>("/api/exchange/trade/", payload),
  };
}

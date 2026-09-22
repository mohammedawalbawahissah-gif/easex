import type { ApiClient } from "../client";
import type { Transaction } from "../../types";

// Read-only by design: money moves only through the dedicated endpoints
// (exchange.trade, giftcards.submit, payments.*), never by a client
// writing ledger rows directly.
export function transactionEndpoints(client: ApiClient) {
  return {
    list: () => client.get<Transaction[]>("/api/transactions/"),
    get: (id: string) => client.get<Transaction>(`/api/transactions/${id}/`),
  };
}

import type { ApiClient } from "../client";
import type { Wallet } from "../../types";

export function walletEndpoints(client: ApiClient) {
  return {
    list: () => client.get<Wallet[]>("/api/wallets/"),
    get: (id: string) => client.get<Wallet>(`/api/wallets/${id}/`),
  };
}

import type { ApiClient } from "../client";
import type { SupportSession } from "../../types";

export function supportEndpoints(client: ApiClient) {
  return {
    /** Gets the user's current open session, or starts a new one. */
    start: () => client.post<SupportSession>("/api/support/start/", {}),
    list: () => client.get<SupportSession[]>("/api/support/"),
    get: (id: string) => client.get<SupportSession>(`/api/support/${id}/`),
    sendMessage: (id: string, body: string) =>
      client.post<SupportSession>(`/api/support/${id}/message/`, { body }),
    /** "Talk to a human" — always honoured immediately. */
    escalate: (id: string) => client.post<SupportSession>(`/api/support/${id}/escalate/`, {}),
  };
}

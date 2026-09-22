import type { ApiClient } from "../client";
import type { RNFilePart, SupportSession } from "../../types";

type Attachment = File | Blob | RNFilePart;

function qs(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries as [string, string][]).toString();
}

export function supportEndpoints(client: ApiClient) {
  return {
    /**
     * Gets the user's current open session, or starts a new one. Pass
     * guestId when the caller isn't signed in — the widget generates and
     * persists this locally (localStorage on web, SecureStore on mobile)
     * so a guest's conversation survives a refresh without an account.
     */
    start: (guestId?: string) => client.post<SupportSession>("/api/support/start/", { guest_id: guestId }),
    list: (guestId?: string) => client.get<SupportSession[]>(`/api/support/${qs({ guest_id: guestId })}`),
    get: (id: string, guestId?: string) =>
      client.get<SupportSession>(`/api/support/${id}/${qs({ guest_id: guestId })}`),
    /**
     * `body` and/or `attachment` — at least one is required (enforced
     * server-side too). Sends multipart whenever there's a file, plain
     * JSON otherwise, so a text-only message doesn't pay for a FormData
     * round-trip it doesn't need.
     */
    sendMessage: (id: string, opts: { body?: string; attachment?: Attachment; guestId?: string }) => {
      if (opts.attachment) {
        const form = new FormData();
        if (opts.body) form.append("body", opts.body);
        if (opts.guestId) form.append("guest_id", opts.guestId);
        form.append("attachment", opts.attachment as unknown as Blob);
        return client.post<SupportSession>(`/api/support/${id}/message/`, form);
      }
      return client.post<SupportSession>(`/api/support/${id}/message/`, {
        body: opts.body,
        guest_id: opts.guestId,
      });
    },
    /** "Talk to a human" — always honoured immediately. */
    escalate: (id: string, guestId?: string) =>
      client.post<SupportSession>(`/api/support/${id}/escalate/`, { guest_id: guestId }),
    /**
     * Call right after login/signup if the client had a guestId with an
     * open session — folds it into the now-authenticated account.
     * Returns null if there was nothing to claim (the common case).
     */
    claimGuest: (guestId: string) =>
      client.post<SupportSession | null>("/api/support/claim_guest/", { guest_id: guestId }),
  };
}

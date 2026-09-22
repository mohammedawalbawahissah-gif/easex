import type { ApiClient } from "../client";
import type { GiftCardCatalog, GiftCardSubmission, SubmitGiftCardPayload } from "../../types";

export function giftcardEndpoints(client: ApiClient) {
  return {
    /** Every sellable brand with its subcategories (country / currency / format / rate). */
    catalog: () => client.get<GiftCardCatalog>("/api/giftcards/catalog/"),
    list: () => client.get<GiftCardSubmission[]>("/api/giftcards/"),
    get: (id: string) => client.get<GiftCardSubmission>(`/api/giftcards/${id}/`),
    submit: (payload: SubmitGiftCardPayload) => {
      // Use FormData whenever a file is attached — card_image, or any of images[].
      const hasFiles = !!payload.card_image || (payload.images && payload.images.length > 0);
      if (hasFiles) {
        const form = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined) return;
          if (key === "images") {
            (value as SubmitGiftCardPayload["images"])?.forEach((file) => {
              // Repeated appends under the same key -> request.FILES.getlist("images") server-side.
              form.append("images", file as unknown as Blob);
            });
          } else if (key === "card_image") {
            // React Native's FormData accepts {uri, name, type} objects at
            // runtime, which DOM's FormData.append types don't model —
            // this cast bridges that gap without weakening the public type.
            form.append(key, value as unknown as Blob);
          } else {
            form.append(key, value as string);
          }
        });
        return client.post<GiftCardSubmission>("/api/giftcards/", form);
      }
      return client.post<GiftCardSubmission>("/api/giftcards/", payload);
    },
  };
}

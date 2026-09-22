import type { ApiClient } from "../client";
import type { KYCSubmission, SubmitKYCPayload } from "../../types";

export function kycEndpoints(client: ApiClient) {
  return {
    list: () => client.get<KYCSubmission[]>("/api/compliance/kyc/"),
    submit: (payload: SubmitKYCPayload) => {
      const form = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined) return;
        if (key === "id_document_front" || key === "id_document_back" || key === "selfie") {
          // Same RN-vs-DOM FormData bridge used by giftcards.submit().
          form.append(key, value as unknown as Blob);
        } else {
          form.append(key, value as string);
        }
      });
      return client.post<KYCSubmission>("/api/compliance/kyc/", form);
    },
  };
}

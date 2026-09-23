import type { ApiClient } from "../client";
import type {
  AdminDashboardStats,
  AdminGiftCardSubmission,
  AdminKYCSubmission,
  AdminSupportSession,
  AdminTransaction,
  AdminUser,
  ApproveGiftCardPayload,
  ComplianceFlag,
  ComplianceFlagStatus,
  ComplianceRiskSettings,
  CopilotMessage,
  GiftCardAssessment,
  KYCAssessment,
  SupportSessionStatus,
  TransactionStatus,
  TransactionType,
} from "../../types";

function qs(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries as [string, string][]).toString();
}

export function adminEndpoints(client: ApiClient) {
  return {
    dashboard: () => client.get<AdminDashboardStats>("/api/admin/dashboard/"),

    kyc: {
      list: (status?: string) => client.get<AdminKYCSubmission[]>(`/api/admin/kyc/${qs({ status })}`),
      review: (id: string, decision: "approve" | "reject", rejection_reason?: string) =>
        client.post<AdminKYCSubmission>(`/api/admin/kyc/${id}/review/`, { decision, rejection_reason }),
    },

    giftcards: {
      list: (params?: { status?: string; brand?: string }) =>
        client.get<AdminGiftCardSubmission[]>(`/api/admin/giftcards/${qs(params ?? {})}`),
      /** Approving requires the redemption attestation; the payout is computed server-side. */
      approve: (id: string, payload: ApproveGiftCardPayload) =>
        client.post<AdminGiftCardSubmission>(`/api/admin/giftcards/${id}/review/`, { decision: "approve", ...payload }),
      reject: (id: string, reviewer_notes?: string) =>
        client.post<AdminGiftCardSubmission>(`/api/admin/giftcards/${id}/review/`, { decision: "reject", reviewer_notes }),
      /**
       * Show the card code so it can be redeemed. Needs a FRESH authenticator code; audited; rate-limited.
       * The code should be displayed briefly (hide_after_seconds) and never stored on the client.
       */
      revealCode: (id: string, otp: string) =>
        client.post<{ code: string; hide_after_seconds: number }>(`/api/admin/giftcards/${id}/reveal-code/`, { otp }),
      flag: (id: string, reviewer_notes?: string) =>
        client.post<AdminGiftCardSubmission>(`/api/admin/giftcards/${id}/review/`, { decision: "flag", reviewer_notes }),
    },

    transactions: {
      // `type` may be a comma-separated list, e.g. "fiat_payout,crypto_withdrawal".
      list: (params?: { status?: TransactionStatus; type?: TransactionType | string }) =>
        client.get<AdminTransaction[]>(`/api/admin/transactions/${qs(params ?? {})}`),
      settle: (id: string) => client.post<AdminTransaction>(`/api/admin/transactions/${id}/settle/`, {}),
      transition: (id: string, status: "verified" | "rejected" | "flagged", reason?: string) =>
        client.post<AdminTransaction>(`/api/admin/transactions/${id}/transition/`, { status, reason }),
    },

    complianceFlags: {
      list: (status?: ComplianceFlagStatus) => client.get<ComplianceFlag[]>(`/api/admin/compliance-flags/${qs({ status })}`),
      resolve: (id: string, status: "cleared" | "escalated", notes?: string) =>
        client.post<ComplianceFlag>(`/api/admin/compliance-flags/${id}/resolve/`, { status, notes }),
    },

    users: {
      list: (params?: { search?: string; kyc_tier?: string; is_flagged?: string }) =>
        client.get<AdminUser[]>(`/api/admin/users/${qs(params ?? {})}`),
      toggleFlag: (id: string) => client.post<AdminUser>(`/api/admin/users/${id}/toggle_flag/`, {}),
    },

    support: {
      /** Defaults to the "waiting for an agent" queue — same default as the queue page itself. Pass "all" for every status. */
      list: (status?: SupportSessionStatus | "all") =>
        client.get<AdminSupportSession[]>(`/api/admin/support/${qs({ status })}`),
      /** A single session by id, regardless of its status — used to deep-link straight from an escalation notification. */
      get: (id: string) => client.get<AdminSupportSession>(`/api/admin/support/${id}/`),
      claim: (id: string) => client.post<AdminSupportSession>(`/api/admin/support/${id}/claim/`, {}),
      sendMessage: (id: string, body: string) =>
        client.post<AdminSupportSession>(`/api/admin/support/${id}/message/`, { body }),
      resolve: (id: string, notes?: string) =>
        client.post<AdminSupportSession>(`/api/admin/support/${id}/resolve/`, { notes }),
    },

    risk: {
      /** null when no assessment exists yet (still running, assist disabled, or a pre-feature submission) — not an error. */
      kycAssessment: (submissionId: string) =>
        client.get<KYCAssessment | null>(`/api/admin/kyc/${submissionId}/assessment/`),
      giftcardAssessment: (submissionId: string) =>
        client.get<GiftCardAssessment | null>(`/api/admin/giftcards/${submissionId}/assessment/`),
      settings: () => client.get<ComplianceRiskSettings>("/api/admin/risk-settings/"),
      updateSettings: (patch: Partial<ComplianceRiskSettings>) =>
        client.post<ComplianceRiskSettings>("/api/admin/risk-settings/", patch),
      /** Stateless — pass the whole conversation each time; the reply is the assistant's next turn. */
      copilot: (messages: CopilotMessage[]) =>
        client.post<CopilotMessage>("/api/admin/copilot/", { messages }),
    },
  };
}

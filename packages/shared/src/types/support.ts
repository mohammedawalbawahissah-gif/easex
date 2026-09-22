export type SupportSessionStatus = "bot_active" | "escalated" | "admin_active" | "resolved";

export type SupportEscalationReason =
  | "user_requested"
  | "restricted_intent"
  | "low_confidence"
  | "manual"
  | "";

export type SupportMessageSender = "user" | "assistant" | "admin";

export interface SupportMessage {
  id: string;
  sender: SupportMessageSender;
  sender_admin_username: string | null;
  body: string;
  attachment_url: string | null;
  attachment_name: string;
  attachment_content_type: string;
  created_at: string;
}

export interface SupportSession {
  id: string;
  status: SupportSessionStatus;
  subject: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  messages: SupportMessage[];
}

export interface AdminSupportSession extends SupportSession {
  username: string;
  escalation_reason: SupportEscalationReason;
  escalation_notes: string;
  assigned_admin_username: string | null;
}

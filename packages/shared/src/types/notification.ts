export type NotificationCategory = "transaction_update" | "kyc_update" | "system";

export interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** What this notification is about, for deep-linking — e.g. "support_session". Empty for most notifications. */
  related_type: string;
  related_id: string;
  is_read: boolean;
  created_at: string;
}

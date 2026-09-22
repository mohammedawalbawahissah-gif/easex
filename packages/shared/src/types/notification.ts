export type NotificationCategory = "transaction_update" | "kyc_update" | "system";

export interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

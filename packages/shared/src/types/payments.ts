import type { Currency } from "./wallet";

export interface NetworkOption {
  value: string;
  label: string;
  needs_memo: boolean;
}

export interface MobileMoneyNetwork {
  value: string;
  label: string;
}

/** Rules and live limits for the money screens — one call draws them all. */
export interface PaymentConfig {
  fiat_currency: "GHS";
  mobile_money_networks: MobileMoneyNetwork[];
  /** Networks each cryptocurrency can be sent/received on. */
  crypto_networks: Record<string, NetworkOption[]>;
  daily_limit_ghs: string;
  outgoing_remaining_ghs: string;
  loads_remaining_ghs: string;
  loads_enabled: boolean;
  withdrawals_enabled: boolean;
  transfers_enabled: boolean;
  auto_approve_withdrawals_up_to_ghs: string;
  giftcard_auto_payment_enabled: boolean;
  giftcard_auto_payout_max_ghs: string;
  auto_payout_cooldown_hours: number;
}

// Every money-moving request carries an idempotency key (generate one per
// form submission with newIdempotencyKey()). Re-sending the same request —
// a double tap, a retry after a dropped connection — returns the original
// result instead of moving money twice.

export interface LoadWalletPayload {
  amount: string;
  network: string;
  phone_number: string;
  idempotency_key: string;
}

export interface ScheduleLoadPayload extends LoadWalletPayload {
  /** ISO-8601 datetime WITH a timezone offset (e.g. from Date.toISOString()). */
  run_at: string;
}

export type ScheduledLoadStatus = "scheduled" | "completed" | "failed" | "cancelled";

export interface ScheduledLoad {
  id: string;
  amount: string;
  network: string;
  phone_number: string;
  run_at: string;
  status: ScheduledLoadStatus;
  failure_reason: string;
  transaction: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface DepositAddress {
  currency: Currency;
  network: string;
  address: string;
  memo: string;
}

export interface WithdrawPayload {
  currency: Currency;
  amount: string;
  /** GHS withdrawals: id of a saved payout account. */
  destination_id?: string;
  /** Crypto withdrawals: destination address, network and (XRP) tag. */
  address?: string;
  network?: string;
  memo?: string;
  /** The 6-digit transaction PIN. */
  pin: string;
  /** Authenticator code — required for withdrawals when the account has 2FA on. */
  otp?: string;
  idempotency_key: string;
}

export interface TransferPayload {
  /** Recipient's username or phone number. */
  recipient: string;
  currency: Currency;
  amount: string;
  note?: string;
  /** The 6-digit transaction PIN. */
  pin: string;
  idempotency_key: string;
}

export interface ScheduleTransferPayload extends TransferPayload {
  /** ISO-8601 datetime WITH a timezone offset (e.g. from Date.toISOString()). */
  run_at: string;
}

export type ScheduledTransferStatus = "scheduled" | "completed" | "failed" | "cancelled";

export interface ScheduledTransfer {
  id: string;
  recipient_username: string;
  currency: Currency;
  amount: string;
  note: string;
  run_at: string;
  status: ScheduledTransferStatus;
  failure_reason: string;
  transaction: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface ScheduleWithdrawPayload extends WithdrawPayload {
  /** ISO-8601 datetime WITH a timezone offset (e.g. from Date.toISOString()). */
  run_at: string;
}

export type ScheduledWithdrawalStatus = "scheduled" | "completed" | "failed" | "cancelled";

export interface ScheduledWithdrawal {
  id: string;
  currency: Currency;
  amount: string;
  destination_id: string | null;
  address: string;
  network: string;
  memo: string;
  run_at: string;
  status: ScheduledWithdrawalStatus;
  failure_reason: string;
  transaction: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface TransferLookupResult {
  /** Masked, e.g. "mo•••d" — enough to confirm you picked the right person. */
  display_name: string;
}

export interface PayoutDestination {
  id: string;
  kind: "mobile_money";
  network: string;
  account_number: string;
  account_name: string;
  created_at: string;
}

export interface CreatePayoutDestinationPayload {
  network: string;
  account_number: string;
  account_name: string;
  password: string;
  /** Required when 2FA is on. */
  otp?: string;
}

export interface PayoutPreference {
  auto_payout_enabled: boolean;
  destination_id: string | null;
  updated_at: string;
}

export interface UpdatePayoutPreferencePayload {
  auto_payout_enabled: boolean;
  destination_id?: string | null;
  password: string;
  /** Required when 2FA is on. */
  otp?: string;
}

import type { ApiClient } from "../client";
import type {
  CreatePayoutDestinationPayload,
  DepositAddress,
  LoadWalletPayload,
  PaymentConfig,
  PayoutDestination,
  PayoutPreference,
  ScheduledLoad,
  ScheduledTransfer,
  ScheduledWithdrawal,
  ScheduleLoadPayload,
  ScheduleTransferPayload,
  ScheduleWithdrawPayload,
  Transaction,
  TransferLookupResult,
  TransferPayload,
  UpdatePayoutPreferencePayload,
  WithdrawPayload,
} from "../../types";

export function paymentEndpoints(client: ApiClient) {
  return {
    config: () => client.get<PaymentConfig>("/api/payments/config/"),

    /** Add GHS via mobile money. */
    load: (payload: LoadWalletPayload) => client.post<Transaction>("/api/payments/load/", payload),
    /** The user's own on-chain deposit address for an asset + network. */
    depositAddress: (currency: string, network: string) =>
      client.get<DepositAddress>(
        `/api/payments/deposit-address/?currency=${encodeURIComponent(currency)}&network=${encodeURIComponent(network)}`
      ),

    withdraw: (payload: WithdrawPayload) => client.post<Transaction>("/api/payments/withdraw/", payload),

    lookupRecipient: (identifier: string) =>
      client.post<TransferLookupResult>("/api/payments/transfers/lookup/", { identifier }),
    transfer: (payload: TransferPayload) => client.post<Transaction>("/api/payments/transfers/", payload),

    scheduled: {
      list: () => client.get<ScheduledTransfer[]>("/api/payments/scheduled-transfers/"),
      create: (payload: ScheduleTransferPayload) =>
        client.post<ScheduledTransfer>("/api/payments/scheduled-transfers/", payload),
      cancel: (id: string) => client.post<ScheduledTransfer>(`/api/payments/scheduled-transfers/${id}/cancel/`, {}),
    },

    scheduledLoads: {
      list: () => client.get<ScheduledLoad[]>("/api/payments/scheduled-loads/"),
      create: (payload: ScheduleLoadPayload) =>
        client.post<ScheduledLoad>("/api/payments/scheduled-loads/", payload),
      cancel: (id: string) => client.post<ScheduledLoad>(`/api/payments/scheduled-loads/${id}/cancel/`, {}),
    },

    scheduledWithdrawals: {
      list: () => client.get<ScheduledWithdrawal[]>("/api/payments/scheduled-withdrawals/"),
      create: (payload: ScheduleWithdrawPayload) =>
        client.post<ScheduledWithdrawal>("/api/payments/scheduled-withdrawals/", payload),
      cancel: (id: string) =>
        client.post<ScheduledWithdrawal>(`/api/payments/scheduled-withdrawals/${id}/cancel/`, {}),
    },

    destinations: {
      list: () => client.get<PayoutDestination[]>("/api/payments/destinations/"),
      create: (payload: CreatePayoutDestinationPayload) =>
        client.post<PayoutDestination>("/api/payments/destinations/", payload),
      remove: (id: string) => client.delete<void>(`/api/payments/destinations/${id}/`),
    },

    payoutPreference: {
      get: () => client.get<PayoutPreference>("/api/payments/payout-preference/"),
      update: (payload: UpdatePayoutPreferencePayload) =>
        client.put<PayoutPreference>("/api/payments/payout-preference/", payload),
    },
  };
}

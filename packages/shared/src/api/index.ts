import { createApiClient, type ApiClientConfig } from "./client";
import { authEndpoints } from "./endpoints/auth";
import { walletEndpoints } from "./endpoints/wallets";
import { transactionEndpoints } from "./endpoints/transactions";
import { giftcardEndpoints } from "./endpoints/giftcards";
import { notificationEndpoints } from "./endpoints/notifications";
import { exchangeEndpoints } from "./endpoints/exchange";
import { kycEndpoints } from "./endpoints/kyc";
import { paymentEndpoints } from "./endpoints/payments";
import { securityEndpoints } from "./endpoints/security";
import { adminEndpoints } from "./endpoints/admin";
import { supportEndpoints } from "./endpoints/support";

export * from "./client";
export * from "./tokenStorage";

/**
 * The single entry point both web and mobile use to talk to the
 * backend. Construct once per app with a platform-specific
 * TokenStorage, then import `easex.auth`, `easex.wallets`, etc.
 * everywhere — this is what makes the two frontends' data layer
 * identical by construction.
 */
export function createEaseXApi(config: ApiClientConfig) {
  const client = createApiClient(config);
  return {
    auth: authEndpoints(client),
    wallets: walletEndpoints(client),
    transactions: transactionEndpoints(client),
    giftcards: giftcardEndpoints(client),
    notifications: notificationEndpoints(client),
    exchange: exchangeEndpoints(client),
    kyc: kycEndpoints(client),
    payments: paymentEndpoints(client),
    security: securityEndpoints(client),
    admin: adminEndpoints(client),
    support: supportEndpoints(client),
  };
}

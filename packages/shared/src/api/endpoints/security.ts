import type { ApiClient } from "../client";
import type { DetailResponse, SecurityStatus, SetPinPayload, TotpEnableResult, TotpSetup, AuthTokens } from "../../types";

export function securityEndpoints(client: ApiClient) {
  return {
    status: () => client.get<SecurityStatus>("/api/security/status/"),

    /** Set or change the 6-digit transaction PIN. */
    setPin: (payload: SetPinPayload) => client.post<DetailResponse>("/api/security/pin/", payload),

    twoFactor: {
      /** Step 1: needs the password. Returns the secret to add to an authenticator app. */
      setup: (password: string) => client.post<TotpSetup>("/api/security/2fa/setup/", { password }),
      /** Step 2: confirm with the first code. Returns recovery codes (once) and fresh tokens. */
      enable: (code: string) => client.post<TotpEnableResult>("/api/security/2fa/enable/", { code }),
      disable: (password: string, code: string) =>
        client.post<DetailResponse & { tokens: AuthTokens }>("/api/security/2fa/disable/", { password, code }),
      regenerateRecoveryCodes: (password: string, code: string) =>
        client.post<{ recovery_codes: string[] }>("/api/security/2fa/recovery-codes/", { password, code }),
    },
  };
}

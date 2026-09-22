import type { AuthTokens } from "./user";

/** Step 1 of sign-in either signs you in, or (accounts with 2FA) asks for a code. */
export type LoginResponse = AuthTokens | { mfa_required: true; mfa_token: string };

export function needsMfa(r: LoginResponse): r is { mfa_required: true; mfa_token: string } {
  return "mfa_required" in r && r.mfa_required === true;
}

export interface SecurityStatus {
  pin_set: boolean;
  totp_enabled: boolean;
  totp_setup_pending: boolean;
  recovery_codes_remaining: number;
  /** ISO time until which money can't leave the account (after a reset / PIN or 2FA change), or null. */
  cooling_off_until: string | null;
  is_staff: boolean;
}

export interface TotpSetup {
  /** Base32 secret to type into an authenticator app. */
  secret: string;
  /** otpauth:// link — on a phone, opening it hands the secret straight to the authenticator app. */
  otpauth_uri: string;
}

export interface TotpEnableResult {
  /** Shown ONCE — the server keeps only digests. */
  recovery_codes: string[];
  /** Fresh tokens for this device (every other session was signed out). Store them. */
  tokens: AuthTokens;
}

export interface SetPinPayload {
  pin: string;
  password: string;
  /** Required when 2FA is on. */
  otp?: string;
}

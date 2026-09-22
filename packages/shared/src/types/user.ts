export type KYCTier = "unverified" | "basic" | "full";

export interface User {
  id: string;
  username: string;
  email: string;
  phone_number: string;
  kyc_tier: KYCTier;
  kyc_verified_at: string | null; // ISO datetime
  is_staff: boolean;
  created_at: string; // ISO datetime
}

export interface RegisterPayload {
  username: string;
  email: string;
  phone_number: string;
  password: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface RegisterResponse {
  user: User;
  access: string;
  refresh: string;
}

export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
  /** Required when 2FA is on. */
  otp?: string;
}

/** Changing the password signs out every other session; this device gets fresh tokens. */
export interface ChangePasswordResponse extends DetailResponse {
  tokens: AuthTokens;
}

export interface PasswordResetRequestPayload {
  email: string;
}

export interface PasswordResetConfirmPayload {
  uid: string;
  token: string;
  new_password: string;
}

export interface DetailResponse {
  detail: string;
}

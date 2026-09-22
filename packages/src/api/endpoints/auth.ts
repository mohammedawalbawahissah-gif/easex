import type { ApiClient } from "../client";
import type {
  LoginPayload,
  RegisterPayload,
  RegisterResponse,
  AuthTokens,
  User,
  ChangePasswordPayload,
  ChangePasswordResponse,
  LoginResponse,
  PasswordResetRequestPayload,
  PasswordResetConfirmPayload,
  DetailResponse,
} from "../../types";

export function authEndpoints(client: ApiClient) {
  return {
    register: (payload: RegisterPayload) =>
      client.post<RegisterResponse>("/api/auth/register/", payload),
    /** Returns tokens, or { mfa_required, mfa_token } for accounts with 2FA (then call login2fa). */
    login: (payload: LoginPayload) => client.post<LoginResponse>("/api/auth/login/", payload),
    login2fa: (payload: { mfa_token: string; code: string }) =>
      client.post<AuthTokens>("/api/auth/login/2fa/", payload),
    me: () => client.get<User>("/api/auth/me/"),
    changePassword: (payload: ChangePasswordPayload) =>
      client.post<ChangePasswordResponse>("/api/auth/change-password/", payload),
    requestPasswordReset: (payload: PasswordResetRequestPayload) =>
      client.post<DetailResponse>("/api/auth/password-reset/", payload),
    confirmPasswordReset: (payload: PasswordResetConfirmPayload) =>
      client.post<DetailResponse>("/api/auth/password-reset-confirm/", payload),
  };
}

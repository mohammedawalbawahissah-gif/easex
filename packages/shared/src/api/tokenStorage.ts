/**
 * Platform-specific token persistence must be injected — web uses
 * localStorage (or better, an httpOnly cookie set by the backend),
 * mobile should use expo-secure-store, NOT AsyncStorage, since
 * access/refresh tokens are sensitive and AsyncStorage is unencrypted.
 */
export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(access: string, refresh: string): Promise<void>;
  clearTokens(): Promise<void>;
}

import * as SecureStore from "expo-secure-store";
import { createEaseXApi, type TokenStorage } from "@easex/shared";

// Mobile MUST use SecureStore, not AsyncStorage — tokens are
// sensitive and AsyncStorage is unencrypted on-device.
const mobileTokenStorage: TokenStorage = {
  getAccessToken: () => SecureStore.getItemAsync("easex_access"),
  getRefreshToken: () => SecureStore.getItemAsync("easex_refresh"),
  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync("easex_access", access);
    await SecureStore.setItemAsync("easex_refresh", refresh);
  },
  clearTokens: async () => {
    await SecureStore.deleteItemAsync("easex_access");
    await SecureStore.deleteItemAsync("easex_refresh");
  },
};

export const easex = createEaseXApi({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000",
  tokenStorage: mobileTokenStorage,
  onAuthExpired: () => {
    // Navigation reset to Login is wired in AuthContext's consumer
  },
});

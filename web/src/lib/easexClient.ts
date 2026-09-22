import { createEaseXApi, type TokenStorage } from "@easex/shared";

// Web token storage. Note: localStorage is acceptable for an MVP,
// but for production, prefer the backend setting refresh tokens as
// an httpOnly cookie so they're never reachable by JS (XSS mitigation).
const webTokenStorage: TokenStorage = {
  getAccessToken: async () => localStorage.getItem("easex_access"),
  getRefreshToken: async () => localStorage.getItem("easex_refresh"),
  setTokens: async (access, refresh) => {
    localStorage.setItem("easex_access", access);
    localStorage.setItem("easex_refresh", refresh);
  },
  clearTokens: async () => {
    localStorage.removeItem("easex_access");
    localStorage.removeItem("easex_refresh");
  },
};

export const easex = createEaseXApi({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  tokenStorage: webTokenStorage,
  onAuthExpired: () => {
    window.location.href = "/login";
  },
});

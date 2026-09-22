import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import type { AuthTokens, User } from "@easex/shared";
import { needsMfa } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { syncPushTokenWithBackend, clearPushTokenOnLogout } from "../lib/pushNotifications";
import { peekGuestId, clearGuestId } from "../lib/guestId";

/**
 * If this device had a guest support chat going before signing in, fold
 * it into the now-authenticated account. Best-effort — a failure here
 * never blocks or surfaces an error on login/register.
 */
async function claimGuestSupportSession() {
  const guestId = await peekGuestId();
  if (!guestId) return;
  try {
    await easex.support.claimGuest(guestId);
    await clearGuestId();
  } catch {
    // stays a guest chat — fine, nothing to surface to the user here
  }
}

interface AuthContextValue {
  user: User | null;
  initializing: boolean; // true while restoring session on app start
  loading: boolean; // true during an in-flight login/register call
  /** Resolves with { mfaToken } when the account has 2FA (then call completeMfaLogin), otherwise signs in. */
  login: (username: string, password: string) => Promise<{ mfaToken: string | null }>;
  completeMfaLogin: (mfaToken: string, code: string) => Promise<void>;
  /** Store fresh tokens the server issued after a security change (it signed out every other session). */
  adoptTokens: (tokens: AuthTokens) => Promise<void>;
  register: (data: { username: string; email: string; phone_number: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);

  // On app start, restore the session from SecureStore instead of
  // forcing the user to log in every time they open the app.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const token = await SecureStore.getItemAsync("easex_access");
      if (!token) {
        setInitializing(false);
        return;
      }
      try {
        const me = await easex.auth.me();
        if (!cancelled) setUser(me);
        syncPushTokenWithBackend(); // fire-and-forget, harmless if it fails or no-ops
      } catch {
        await SecureStore.deleteItemAsync("easex_access");
        await SecureStore.deleteItemAsync("easex_refresh");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const adoptTokens = useCallback(async (tokens: AuthTokens) => {
    await SecureStore.setItemAsync("easex_access", tokens.access);
    await SecureStore.setItemAsync("easex_refresh", tokens.refresh);
  }, []);

  const finishSignIn = useCallback(
    async (tokens: AuthTokens) => {
      await adoptTokens(tokens);
      const me = await easex.auth.me();
      setUser(me);
      syncPushTokenWithBackend(); // fire-and-forget
      claimGuestSupportSession(); // fire-and-forget
    },
    [adoptTokens]
  );

  const login = useCallback(
    async (username: string, password: string) => {
      setLoading(true);
      try {
        const result = await easex.auth.login({ username, password });
        if (needsMfa(result)) return { mfaToken: result.mfa_token };
        await finishSignIn(result);
        return { mfaToken: null };
      } finally {
        setLoading(false);
      }
    },
    [finishSignIn]
  );

  const completeMfaLogin = useCallback(
    async (mfaToken: string, code: string) => {
      setLoading(true);
      try {
        await finishSignIn(await easex.auth.login2fa({ mfa_token: mfaToken, code }));
      } finally {
        setLoading(false);
      }
    },
    [finishSignIn]
  );

  const register = useCallback(
    async (data: { username: string; email: string; phone_number: string; password: string }) => {
      setLoading(true);
      try {
        const result = await easex.auth.register(data);
        await SecureStore.setItemAsync("easex_access", result.access);
        await SecureStore.setItemAsync("easex_refresh", result.refresh);
        setUser(result.user);
        syncPushTokenWithBackend(); // fire-and-forget
        claimGuestSupportSession(); // fire-and-forget
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    await clearPushTokenOnLogout(); // needs the still-valid access token, so this must run first
    await SecureStore.deleteItemAsync("easex_access");
    await SecureStore.deleteItemAsync("easex_refresh");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, initializing, loading, login, completeMfaLogin, adoptTokens, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { AuthTokens, User } from "@easex/shared";
import { needsMfa } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { syncWebPushWithBackend, clearWebPushOnLogout } from "../lib/webPush";
import { peekGuestId, clearGuestId } from "../lib/guestId";

/**
 * If this browser had a guest support chat going before signing in,
 * fold it into the now-authenticated account. Best-effort: a failure
 * here (offline, server hiccup) just means the guest chat stays a
 * guest chat — never blocks or surfaces an error on login/register.
 */
function claimGuestSupportSession() {
  const guestId = peekGuestId();
  if (!guestId) return;
  easex.support
    .claimGuest(guestId)
    .then(() => clearGuestId())
    .catch(() => {});
}

interface AuthContextValue {
  user: User | null;
  initializing: boolean; // true while restoring session on first load
  loading: boolean; // true during an in-flight login/register call
  /** Resolves with { mfaToken } when the account has 2FA (then call completeMfaLogin), otherwise signs in. */
  login: (username: string, password: string) => Promise<{ mfaToken: string | null }>;
  completeMfaLogin: (mfaToken: string, code: string) => Promise<void>;
  /** Store fresh tokens the server issued after a security change (it signed out every other session). */
  adoptTokens: (tokens: AuthTokens) => void;
  register: (data: { username: string; email: string; phone_number: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);

  // On first load, if a token already exists (page refresh, new tab),
  // restore the session instead of forcing a re-login.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const hasToken = !!localStorage.getItem("easex_access");
      if (!hasToken) {
        setInitializing(false);
        return;
      }
      try {
        const me = await easex.auth.me();
        if (!cancelled) setUser(me);
        syncWebPushWithBackend(); // fire-and-forget, harmless if it fails or no-ops
      } catch {
        localStorage.removeItem("easex_access");
        localStorage.removeItem("easex_refresh");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const finishSignIn = useCallback(async (tokens: AuthTokens) => {
    localStorage.setItem("easex_access", tokens.access);
    localStorage.setItem("easex_refresh", tokens.refresh);
    const me = await easex.auth.me();
    setUser(me);
    syncWebPushWithBackend(); // fire-and-forget
    claimGuestSupportSession(); // fire-and-forget — folds a pre-login chat into the account
  }, []);

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

  const adoptTokens = useCallback((tokens: AuthTokens) => {
    localStorage.setItem("easex_access", tokens.access);
    localStorage.setItem("easex_refresh", tokens.refresh);
  }, []);

  const register = useCallback(
    async (data: { username: string; email: string; phone_number: string; password: string }) => {
      setLoading(true);
      try {
        const result = await easex.auth.register(data);
        localStorage.setItem("easex_access", result.access);
        localStorage.setItem("easex_refresh", result.refresh);
        setUser(result.user);
        syncWebPushWithBackend(); // fire-and-forget
        claimGuestSupportSession(); // fire-and-forget
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    await clearWebPushOnLogout(); // needs the still-valid access token, so this must run first
    localStorage.removeItem("easex_access");
    localStorage.removeItem("easex_refresh");
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

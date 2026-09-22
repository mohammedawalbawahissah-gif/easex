import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

/**
 * Wrap any admin-portal route. Same session-restoration wait as
 * RequireAuth, plus an is_staff check — a logged-in customer who
 * navigates to /admin/* directly gets bounced to /wallet rather
 * than seeing a broken page (the backend also enforces this on
 * every admin endpoint independently, so this is UX, not security).
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth();

  if (initializing) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_staff) return <Navigate to="/wallet" replace />;
  return <>{children}</>;
}

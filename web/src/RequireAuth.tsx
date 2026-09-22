import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

/**
 * Wrap any route that requires login. Waits for session
 * restoration to finish before deciding, so a page refresh
 * doesn't briefly bounce a logged-in user back to /login.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth();

  if (initializing) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

import { useCallback, useEffect, useState } from "react";
import type { SecurityStatus } from "@easex/shared";
import { easex } from "./easexClient";

/** PIN / 2FA / cooling-off state for the current user. `refresh` re-reads it after a change. */
export function useSecurityStatus() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const refresh = useCallback(
    () =>
      easex.security
        .status()
        .then(setStatus)
        .catch(() => {}),
    []
  );
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { status, refresh };
}

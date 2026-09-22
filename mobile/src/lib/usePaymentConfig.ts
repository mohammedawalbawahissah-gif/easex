import { useCallback, useEffect, useState } from "react";
import type { PaymentConfig } from "@easex/shared";
import { easex } from "./easexClient";

/** Rules + live limits for the money screens. `refresh` re-reads them after money moves. */
export function usePaymentConfig() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);

  const refresh = useCallback(
    () =>
      easex.payments
        .config()
        .then(setConfig)
        .catch(() => {}),
    []
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, refresh };
}

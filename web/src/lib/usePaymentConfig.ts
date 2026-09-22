import { useEffect, useState } from "react";
import type { PaymentConfig } from "@easex/shared";
import { easex } from "./easexClient";

/** Rules + live limits for the money screens. `refresh` re-reads them after money moves. */
export function usePaymentConfig() {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [error, setError] = useState(false);

  const refresh = () =>
    easex.payments
      .config()
      .then((c) => {
        setConfig(c);
        setError(false);
      })
      .catch(() => setError(true));

  useEffect(() => {
    refresh();
  }, []);

  return { config, error, refresh };
}

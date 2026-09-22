import { CURRENCY_META } from "../lib/currencyMeta";
import type { Currency } from "@easex/shared";

export default function AssetIcon({ currency, size = 32 }: { currency: Currency; size?: number }) {
  const meta = CURRENCY_META[currency];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "100%",
        background: meta.color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: size * 0.44,
        flexShrink: 0,
      }}
    >
      {meta.glyph}
    </div>
  );
}

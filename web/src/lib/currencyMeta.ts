import type { Currency } from "@easex/shared";

export const CURRENCY_META: Record<Currency, { color: string; glyph: string; name: string }> = {
  GHS: { color: "#1f3a5f", glyph: "₵", name: "Ghanaian Cedi" },
  BTC: { color: "#f2a900", glyph: "₿", name: "Bitcoin" },
  ETH: { color: "#627eea", glyph: "Ξ", name: "Ethereum" },
  USDT: { color: "#26a17b", glyph: "₮", name: "Tether" },
  USDC: { color: "#2775ca", glyph: "$", name: "USD Coin" },
  BNB: { color: "#f0b90b", glyph: "B", name: "BNB" },
  SOL: { color: "#9945ff", glyph: "S", name: "Solana" },
  XRP: { color: "#23292f", glyph: "X", name: "XRP" },
  ADA: { color: "#0033ad", glyph: "A", name: "Cardano" },
  DOGE: { color: "#c2a633", glyph: "Ð", name: "Dogecoin" },
  LTC: { color: "#345d9d", glyph: "Ł", name: "Litecoin" },
};

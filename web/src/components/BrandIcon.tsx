import { brandGlyph } from "@easex/shared";

/** Shown when a brand's own colours aren't known (e.g. an old submission whose brand has since been removed). */
const NEUTRAL = { from: "#565b6b", to: "#7a8194" };

/**
 * A brand's mark: its two colours and a two-letter monogram of its name (Am, GP, PS) — the same mark as the
 * tiles and the selected-brand header on the sell screen. Not a real logo (trademark risk, no artwork). Decorative: the
 * brand name is always written next to it, so it's hidden from screen readers.
 */
export default function BrandIcon({
  name,
  from = NEUTRAL.from,
  to = NEUTRAL.to,
  size = 36,
}: {
  name: string;
  from?: string;
  to?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size * 0.36,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {brandGlyph(name)}
    </span>
  );
}

import { View, Text, StyleSheet } from "react-native";
import { brandGlyph } from "@easex/shared";
import { fonts } from "../theme";

/** Shown when a brand's own colour isn't known (e.g. an old submission whose brand has since been removed). */
const NEUTRAL_FROM = "#565b6b";

/**
 * A brand's mark: its colour and a two-letter monogram of its name (Am, GP, PS) — the same mark as the
 * tiles and the selected-brand header on the sell screen. Not a real logo (trademark risk, no artwork). Decorative: the
 * brand name is always written next to it, so it's hidden from screen readers. (React Native has no
 * built-in gradient, so this uses the brand's start colour.)
 */
export default function BrandIcon({ name, from = NEUTRAL_FROM, size = 36 }: { name: string; from?: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.badge, { width: size, height: size, borderRadius: size * 0.25, backgroundColor: from }]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.36 }]}>{brandGlyph(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
  letter: { fontFamily: fonts.displaySemiBold, color: "#fff", includeFontPadding: false },
});

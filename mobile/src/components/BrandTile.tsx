import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { brandGlyph } from "@easex/shared";
import { fonts } from "../theme";
import GradientBox from "./GradientBox";

// The web's grid is `repeat(auto-fill, minmax(140px, 1fr))` with a 12px gap and tiles at aspect-ratio 1.6.
// These are the same numbers, so the tiles wrap into the same number of columns and the same shape.
export const TILE_MIN_WIDTH = 140;
export const TILE_GAP = 12;
const TILE_ASPECT = 1.6;

/** Same result as CSS auto-fill/minmax: how many columns fit, and how wide each tile is. */
export function tileWidth(contentWidth: number): number {
  const columns = Math.max(1, Math.floor((contentWidth + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)));
  return (contentWidth - TILE_GAP * (columns - 1)) / columns;
}

/**
 * A gift card brand tile, matching the web's `.brand-card`: 135° gradient in the brand's two colours, rounded
 * 12px, soft shadow, a translucent monogram top-left, and "GIFT CARD" over the brand name bottom-left.
 */
export default function BrandTile({
  name,
  from,
  to,
  width,
  onPress,
}: {
  name: string;
  from: string;
  to: string;
  width: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name} gift card`}
      // backgroundColor is the fallback for the frame before the gradient measures itself, and lets the shadow render.
      style={[styles.tile, { width, height: width / TILE_ASPECT, backgroundColor: from }]}
    >
      <View style={styles.clip}>
        <GradientBox from={from} to={to} />
      </View>
      <View style={styles.content}>
        <View style={styles.monogram}>
          <Text style={styles.monogramText}>{brandGlyph(name)}</Text>
        </View>
        <View>
          <Text style={styles.tag}>Gift card</Text>
          <Text style={styles.name}>{name}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 12,
    shadowColor: "#15171f",
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  clip: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, overflow: "hidden" },
  // web: 14px padding inside a 2px transparent border
  content: { flex: 1, padding: 16, justifyContent: "space-between" },
  monogram: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  monogramText: { fontFamily: fonts.displayBold, fontSize: 12, color: "#fff", includeFontPadding: false },
  tag: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.33, textTransform: "uppercase", opacity: 0.75, color: "#fff" },
  name: { fontFamily: fonts.displayBold, fontSize: 16, color: "#fff" },
});

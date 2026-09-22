import { View, Text, StyleSheet } from "react-native";
import type { Currency } from "@easex/shared";
import { CURRENCY_META } from "../lib/currencyMeta";
import { fonts } from "../theme";

export default function AssetIcon({ currency, size = 32 }: { currency: Currency; size?: number }) {
  const meta = CURRENCY_META[currency];
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: meta.color },
      ]}
    >
      <Text style={[styles.glyph, { fontSize: size * 0.44 }]}>{meta.glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  glyph: { fontFamily: fonts.displaySemiBold, color: "#fff" },
});

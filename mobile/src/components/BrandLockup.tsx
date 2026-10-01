import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colors, fonts } from "../theme";
import AppIcon from "./AppIcon";

/** App icon beside the "EaseX" wordmark — the brand block at the top of the login / register / forgot-password screens. */
export default function BrandLockup({
  iconSize = 44,
  fontSize = 24,
  style,
}: {
  iconSize?: number;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      <AppIcon size={iconSize} />
      <Text style={[styles.text, { fontSize }]}>
        Ease<Text style={{ color: colors.gold }}>X</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 32 },
  text: { fontFamily: fonts.displayBold, color: colors.ink },
});

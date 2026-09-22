import { View, Text, StyleSheet } from "react-native";
import { colors, fonts, statusColors, statusLabel } from "../theme";

export default function StatusPill({ status }: { status: string }) {
  const sc = statusColors[status] ?? { bg: colors.line, fg: colors.inkSoft };
  return (
    <View style={[styles.pill, { backgroundColor: sc.bg }]}>
      <Text style={[styles.text, { color: sc.fg }]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 9, borderRadius: 100 },
  text: { fontFamily: fonts.bodyMedium, fontSize: 12, textTransform: "capitalize" },
});

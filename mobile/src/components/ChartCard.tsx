import { type ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, fonts } from "../theme";

export default function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    backgroundColor: colors.paperRaised,
  },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 13, color: colors.ink, marginBottom: 8 },
});

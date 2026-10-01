import { View, Text, StyleSheet } from "react-native";
import { colors, fonts } from "../theme";
import AppIcon from "./AppIcon";

/**
 * Navigation-header title with the app icon in front, so the icon is on every screen the way web's AppShell shows
 * it on every page. Pass `brand` on Home to show the "EaseX" wordmark instead of a page title.
 */
export default function HeaderTitle({ children, brand }: { children?: string; brand?: boolean }) {
  return (
    <View style={styles.row}>
      <AppIcon size={28} />
      {brand ? (
        <Text style={styles.text}>
          Ease<Text style={{ color: colors.gold }}>X</Text>
        </Text>
      ) : (
        <Text style={styles.text} numberOfLines={1}>
          {children}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink },
});

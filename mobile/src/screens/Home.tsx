import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../theme";

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.greeting}>Welcome{user ? `, ${user.username}` : ""}</Text>
      <Text style={styles.subtitle}>What would you like to do?</Text>

      <View style={styles.grid}>
        <TouchableOpacity
          style={[styles.card, styles.cardSmall]}
          onPress={() => router.push("/(tabs)/wallet")}
        >
          <SymbolView
            name={{ ios: "wallet.pass", android: "account_balance_wallet", web: "wallet" }}
            tintColor={colors.gold}
            size={22}
          />
          <Text style={styles.cardTitle}>Wallet</Text>
          <Text style={styles.cardSubtitle}>Balance & activity</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push("/(tabs)/trade")}>
          <SymbolView
            name={{ ios: "arrow.left.arrow.right", android: "swap_horiz", web: "repeat" }}
            tintColor={colors.gold}
            size={26}
          />
          <Text style={styles.cardTitle}>Trade</Text>
          <Text style={styles.cardSubtitle}>Buy and sell crypto at current rates</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push("/(tabs)/giftcards")}>
          <SymbolView
            name={{ ios: "creditcard", android: "credit_card", web: "credit-card" }}
            tintColor={colors.gold}
            size={26}
          />
          <Text style={styles.cardTitle}>Gift cards</Text>
          <Text style={styles.cardSubtitle}>Sell a card for cash</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  greeting: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 2, marginBottom: 24 },
  grid: { gap: 14 },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 20,
    backgroundColor: colors.paperRaised,
    gap: 4,
  },
  // Wallet is deliberately the smallest card on Home — less padding,
  // no subtitle line — so Trade and Gift cards read as the two
  // primary actions and Wallet reads as a quick-glance summary link.
  cardSmall: {
    padding: 14,
  },
  cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink, marginTop: 6 },
  cardSubtitle: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
});

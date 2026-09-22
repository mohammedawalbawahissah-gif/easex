import { View, Text, StyleSheet } from "react-native";

// Temporary stand-in for the real wallet/dashboard screen we'll
// build next. Replace this import in App.tsx once that screen exists,
// or swap in your existing tab navigator here instead.
export default function PlaceholderHome() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>You're logged in. Wallet screen coming next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  text: { fontSize: 16 },
});

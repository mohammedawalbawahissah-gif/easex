import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import type { AdminUser } from "@easex/shared";
import { easex } from "../../lib/easexClient";
import { colors, fonts } from "../../theme";
import FilterChips from "../../components/FilterChips";

const TIER_FILTERS = [
  { value: "", label: "All tiers" },
  { value: "unverified", label: "Unverified" },
  { value: "basic", label: "Basic" },
  { value: "full", label: "Full" },
];

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    easex.admin.users
      .list({ search: search || undefined, kyc_tier: tierFilter || undefined })
      .then(setUsers)
      .catch(() => setError("Couldn't load users."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300); // debounce search-as-you-type
    return () => clearTimeout(t);
  }, [search, tierFilter]);

  const toggleFlag = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const updated = await easex.admin.users.toggleFlag(id);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch {
      setError("Couldn't update — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search username, email, phone…"
        value={search}
        onChangeText={setSearch}
      />
      <FilterChips options={TIER_FILTERS} value={tierFilter} onChange={setTierFilter} />

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : users.length === 0 ? (
        <Text style={styles.muted}>No users match.</Text>
      ) : (
        users.map((u) => (
          <View key={u.id} style={[styles.row, u.is_flagged && styles.rowFlagged]}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.rowTitle}>
                {u.username} {u.is_staff && <Text style={styles.staffBadge}> staff</Text>}
              </Text>
              <Text style={styles.rowSub}>{u.email}</Text>
              <Text style={styles.rowSub}>{u.phone_number}</Text>
              <Text style={styles.rowTier}>{u.kyc_tier}</Text>
            </View>
            <TouchableOpacity
              style={u.is_flagged ? styles.primaryBtn : styles.dangerBtn}
              onPress={() => toggleFlag(u.id)}
              disabled={busyId === u.id}
            >
              <Text style={u.is_flagged ? styles.primaryBtnText : styles.dangerBtnText}>
                {u.is_flagged ? "Unflag" : "Flag"}
              </Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 16, paddingBottom: 48 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginBottom: 12 },
  searchInput: {
    fontFamily: fonts.bodyRegular,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    padding: 10,
    backgroundColor: colors.paperRaised,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 14,
    backgroundColor: colors.paperRaised,
    marginBottom: 10,
  },
  rowFlagged: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  rowTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  rowSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  rowTier: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.ink, marginTop: 4, textTransform: "capitalize" },
  staffBadge: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.paper, backgroundColor: colors.ink },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
  primaryBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: "#17130A" },
  dangerBtn: { borderWidth: 1, borderColor: colors.danger, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
  dangerBtnText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.danger },
});

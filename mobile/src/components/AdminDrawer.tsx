import { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { colors, fonts } from "../theme";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/kyc", label: "Verification" },
  { to: "/admin/giftcards", label: "Gift cards" },
  { to: "/admin/transactions", label: "Transactions" },
  { to: "/admin/compliance", label: "Compliance flags" },
  { to: "/admin/support", label: "Support" },
  { to: "/admin/copilot", label: "Copilot" },
  { to: "/admin/users", label: "Users" },
] as const;

/**
 * The mobile equivalent of web's persistent left sidebar (AdminShell.tsx,
 * same 8 sections in the same order). A permanently-visible sidebar
 * doesn't fit a phone-width screen, so this is the standard mobile
 * translation: a slide-out panel triggered by a hamburger button,
 * mounted once in admin/_layout.tsx so every admin screen gets it via
 * the same header button rather than each screen wiring its own.
 */
export function AdminDrawerButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} accessibilityLabel="Open admin menu" style={styles.hamburger}>
        <View style={styles.hamburgerLine} />
        <View style={styles.hamburgerLine} />
        <View style={styles.hamburgerLine} />
      </TouchableOpacity>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.panel} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.panelTitle}>Admin</Text>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.to || (item.to !== "/admin" && pathname?.startsWith(item.to));
              return (
                <TouchableOpacity
                  key={item.to}
                  style={[styles.navItem, active && styles.navItemActive]}
                  onPress={() => {
                    setOpen(false);
                    router.push(item.to as never);
                  }}
                >
                  <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => {
                setOpen(false);
                router.push("/(tabs)" as never);
              }}
            >
              <Text style={styles.navText}>Back to app</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => {
                setOpen(false);
                logout();
              }}
            >
              <Text style={[styles.navText, { color: colors.danger }]}>Log out</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hamburger: { padding: 8, gap: 3, justifyContent: "center" },
  hamburgerLine: { width: 20, height: 2, backgroundColor: colors.ink, borderRadius: 1 },
  backdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.3)" },
  panel: {
    width: 250,
    backgroundColor: colors.paperRaised,
    paddingTop: 60,
    paddingHorizontal: 12,
    height: "100%",
  },
  panelTitle: { fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink, marginBottom: 16, paddingHorizontal: 10 },
  navItem: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8 },
  navItemActive: { backgroundColor: colors.gold },
  navText: { fontFamily: fonts.bodyMedium, fontSize: 14.5, color: colors.ink },
  navTextActive: { color: "#17130A", fontFamily: fonts.bodySemiBold },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
});

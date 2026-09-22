import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema, type ChangePasswordFormValues, apiErrorMessage } from "@easex/shared";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import { colors, fonts, statusColors } from "../theme";
import PasswordField from "../components/PasswordField";

const TIER_LABELS: Record<string, string> = {
  unverified: "Unverified",
  basic: "Basic",
  full: "Full",
};

const TIER_LIMITS: Record<string, string> = {
  unverified: "0 GHS",
  basic: "2,000 GHS",
  full: "50,000 GHS",
};

// Reuse the same status color scale as transactions — full tier
// reads as "success", unverified reads as "danger", basic as "pending".
const TIER_STATUS_KEY: Record<string, string> = {
  unverified: "rejected",
  basic: "pending",
  full: "verified",
};

export default function ProfileScreen() {
  const { user, logout, adoptTokens } = useAuth();
  const { status: security } = useSecurityStatus();
  const [otp, setOtp] = useState("");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = async (values: ChangePasswordFormValues) => {
    setServerError(null);
    setSuccessMsg(null);
    try {
      const result = await easex.auth.changePassword({ ...values, ...(security?.totp_enabled ? { otp: otp.trim() } : {}) });
      // Changing the password signs out every OTHER session; this device is handed fresh tokens.
      await adoptTokens(result.tokens);
      setSuccessMsg("Password updated. Your other devices have been signed out.");
      setOtp("");
      reset();
    } catch (err) {
      setServerError(apiErrorMessage(err, "Something went wrong. Please try again."));
    }
  };

  if (!user) return null;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  };

  const tierSc = statusColors[TIER_STATUS_KEY[user.kyc_tier]] ?? { bg: colors.line, fg: colors.inkSoft };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Account</Text>

      <Text style={styles.sectionTitle}>Security</Text>
      <View style={styles.row}>
        <Text style={styles.rowTitle}>Transaction PIN</Text>
        <Text style={styles.rowMeta}>{security ? (security.pin_set ? "Set" : "Not set") : "…"}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowTitle}>Two-factor authentication</Text>
        <Text style={styles.rowMeta}>{security ? (security.totp_enabled ? "On" : "Off") : "…"}</Text>
      </View>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.indigo, marginVertical: 12 }} onPress={() => router.replace("/(tabs)/security")}>
        Manage PIN and two-factor authentication →
      </Text>

      <Text style={styles.sectionTitle}>Details</Text>
      <View style={styles.passbook}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Username</Text>
          <Text style={styles.rowMeta}>{user.username}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Email</Text>
          <Text style={styles.rowMeta}>{user.email}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Phone</Text>
          <Text style={styles.rowMeta}>{user.phone_number || "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Verification tier</Text>
          <View style={[styles.statusPill, { backgroundColor: tierSc.bg }]}>
            <Text style={[styles.statusText, { color: tierSc.fg }]}>
              {TIER_LABELS[user.kyc_tier]} · {TIER_LIMITS[user.kyc_tier]}
            </Text>
          </View>
        </View>
      </View>

      {user.kyc_tier !== "full" && (
        <TouchableOpacity style={styles.verifyButton} onPress={() => router.replace("/(tabs)/verification")}>
          <Text style={styles.verifyButtonText}>Verify your account</Text>
        </TouchableOpacity>
      )}

      {user.is_staff && (
        <TouchableOpacity style={styles.adminButton} onPress={() => router.replace("/admin")}>
          <Text style={styles.adminButtonText}>Admin portal</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.sectionTitle}>Change password</Text>

      <Text style={styles.label}>Current password</Text>
      <Controller
        control={control}
        name="old_password"
        render={({ field: { onChange, value } }) => (
          <PasswordField style={styles.input} value={value} onChangeText={onChange} />
        )}
      />
      {errors.old_password && <Text style={styles.error}>{errors.old_password.message}</Text>}

      <Text style={styles.label}>New password</Text>
      <Controller
        control={control}
        name="new_password"
        render={({ field: { onChange, value } }) => (
          <PasswordField style={styles.input} value={value} onChangeText={onChange} />
        )}
      />
      {errors.new_password && <Text style={styles.error}>{errors.new_password.message}</Text>}

      {security?.totp_enabled && (
        <View>
          <Text style={styles.label}>Authenticator code</Text>
          <TextInput style={styles.input} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
        </View>
      )}

      {serverError && <Text style={styles.error}>{serverError}</Text>}
      {successMsg && <Text style={styles.success}>{successMsg}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>
        <Text style={styles.buttonText}>{isSubmitting ? "Updating…" : "Update password"}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} disabled={loggingOut}>
        <Text style={styles.logoutButtonText}>{loggingOut ? "Logging out…" : "Log out"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, marginBottom: 20 },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 8, marginBottom: 12 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line, marginBottom: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  rowMeta: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
  statusPill: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 100 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSoft, marginBottom: 6, marginTop: 14 },
  input: {
    fontFamily: fonts.bodyRegular,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    padding: 12,
    backgroundColor: colors.paperRaised,
    color: colors.ink,
  },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginTop: 6, fontSize: 13 },
  success: { fontFamily: fonts.bodyRegular, color: colors.success, marginTop: 6, fontSize: 13 },
  button: { backgroundColor: colors.gold, padding: 14, borderRadius: 6, marginTop: 24, alignItems: "center" },
  buttonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 15 },
  verifyButton: {
    backgroundColor: colors.gold,
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    alignItems: "center",
  },
  verifyButtonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 14 },
  adminButton: {
    borderWidth: 1,
    borderColor: colors.ink,
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    alignItems: "center",
  },
  adminButtonText: { fontFamily: fonts.bodySemiBold, color: colors.ink, fontSize: 14 },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    borderRadius: 6,
    marginTop: 32,
    alignItems: "center",
  },
  logoutButtonText: { fontFamily: fonts.bodyMedium, color: colors.danger, fontSize: 15 },
});

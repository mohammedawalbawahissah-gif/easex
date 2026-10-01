import { useState } from "react";
import { Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordResetRequestSchema, type PasswordResetRequestFormValues } from "@easex/shared";
import { useRouter } from "expo-router";
import { easex } from "../lib/easexClient";
import { colors, fonts } from "../theme";
import BrandLockup from "../components/BrandLockup";
import { useKeyboardHeight } from "../lib/useKeyboardHeight";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequestFormValues>({ resolver: zodResolver(passwordResetRequestSchema) });

  const onSubmit = async (values: PasswordResetRequestFormValues) => {
    // Same generic response either way — the backend never reveals
    // whether the email is registered.
    await easex.auth.requestPasswordReset(values);
    setSubmitted(true);
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { flexGrow: 1, paddingTop: insets.top + 28, paddingBottom: keyboardHeight }]} keyboardShouldPersistTaps="handled">
      <BrandLockup />

      {submitted ? (
        <Text style={styles.body}>
          If that email is registered, we've sent a link to reset your password.
          Open it from this device to finish resetting.
        </Text>
      ) : (
        <>
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>Enter your email and we'll send you a reset link.</Text>

          <Text style={styles.label}>Email</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={onChange}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            )}
          />
          {errors.email && <Text style={styles.error}>{errors.email.message}</Text>}

          <TouchableOpacity style={styles.button} onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>
            <Text style={styles.buttonText}>{isSubmitting ? "Sending…" : "Send reset link"}</Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity onPress={() => router.push("/login")}>
        <Text style={styles.link}>Back to log in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 28, justifyContent: "center", backgroundColor: colors.paper },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 4, marginBottom: 20 },
  body: { fontFamily: fonts.bodyRegular, fontSize: 15, color: colors.ink, lineHeight: 22 },
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
  button: { backgroundColor: colors.gold, padding: 14, borderRadius: 6, marginTop: 24, alignItems: "center" },
  buttonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 15 },
  link: { fontFamily: fonts.bodyRegular, marginTop: 24, textAlign: "center", color: colors.inkSoft, fontSize: 14 },
});

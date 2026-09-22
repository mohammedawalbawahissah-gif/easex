import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginFormValues, ApiError, apiErrorMessage } from "@easex/shared";
import { useRouter } from "expo-router";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../theme";
import PasswordField from "../components/PasswordField";

export default function LoginScreen() {
  const { login, completeMfaLogin } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  // Step 2 of sign-in, for accounts with two-factor authentication.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      const result = await login(values.username, values.password);
      if (result.mfaToken) {
        setMfaToken(result.mfaToken);
        return;
      }
      router.replace("/(tabs)");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setServerError("Incorrect username or password.");
      } else if (err instanceof ApiError && err.status === 429) {
        setServerError(apiErrorMessage(err));
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  const submitCode = async () => {
    if (!mfaToken) return;
    setMfaBusy(true);
    setServerError(null);
    try {
      await completeMfaLogin(mfaToken, code.trim());
      router.replace("/(tabs)");
    } catch (err) {
      setServerError(apiErrorMessage(err, "Something went wrong. Please try again."));
      // An expired sign-in can't be retried with the same token: go back to the password step.
      if (err instanceof ApiError && (err.body as { code?: string } | undefined)?.code === "mfa_expired") setMfaToken(null);
    } finally {
      setMfaBusy(false);
    }
  };

  if (mfaToken) {
    return (
      <View style={styles.container}>
        <Text style={styles.brand}>Ease<Text style={{ color: colors.gold }}>X</Text></Text>
        <Text style={styles.title}>Two-factor code</Text>
        <Text style={[styles.label, { marginBottom: 12 }]}>
          Enter the 6-digit code from your authenticator app. Lost your phone? Use a recovery code instead.
        </Text>
        <TextInput style={styles.input} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
        {serverError && <Text style={styles.error}>{serverError}</Text>}
        <TouchableOpacity style={styles.button} onPress={submitCode} disabled={mfaBusy || !code}>
          <Text style={styles.buttonText}>{mfaBusy ? "Checking…" : "Verify"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setMfaToken(null); setCode(""); setServerError(null); }}>
          <Text style={styles.link}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>
        Ease<Text style={{ color: colors.gold }}>X</Text>
      </Text>
      <Text style={styles.title}>Log in</Text>

      <Text style={styles.label}>Username</Text>
      <Controller
        control={control}
        name="username"
        render={({ field: { onChange, value } }) => (
          <TextInput style={styles.input} value={value} onChangeText={onChange} autoCapitalize="none" />
        )}
      />
      {errors.username && <Text style={styles.error}>{errors.username.message}</Text>}

      <Text style={styles.label}>Password</Text>
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, value } }) => (
          <PasswordField style={styles.input} value={value} onChangeText={onChange} />
        )}
      />
      {errors.password && <Text style={styles.error}>{errors.password.message}</Text>}

      {serverError && <Text style={styles.error}>{serverError}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>
        <Text style={styles.buttonText}>{isSubmitting ? "Logging in…" : "Log in"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/forgot-password")}>
        <Text style={styles.link}>Forgot password?</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/register")}>
        <Text style={styles.link}>Don't have an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 28, justifyContent: "center", backgroundColor: colors.paper },
  brand: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink, marginBottom: 32 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 24, color: colors.ink, marginBottom: 24 },
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
  button: {
    backgroundColor: colors.gold,
    padding: 14,
    borderRadius: 6,
    marginTop: 24,
    alignItems: "center",
  },
  buttonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 15 },
  link: { fontFamily: fonts.bodyRegular, marginTop: 18, textAlign: "center", color: colors.inkSoft, fontSize: 14 },
});

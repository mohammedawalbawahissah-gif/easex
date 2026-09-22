import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterFormValues, ApiError } from "@easex/shared";
import { useRouter } from "expo-router";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../theme";
import PasswordField from "../components/PasswordField";

export default function RegisterScreen() {
  const { register: doRegister } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    try {
      await doRegister(values);
      router.replace("/(tabs)");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setServerError("Please check your details — a field may already be in use.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  const fields: Array<{
    name: keyof RegisterFormValues;
    label: string;
    secure?: boolean;
    keyboardType?: "default" | "email-address" | "phone-pad";
  }> = [
    { name: "username", label: "Username" },
    { name: "email", label: "Email", keyboardType: "email-address" },
    { name: "phone_number", label: "Phone number (+233...)", keyboardType: "phone-pad" },
    { name: "password", label: "Password", secure: true },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.brand}>
        Ease<Text style={{ color: colors.gold }}>X</Text>
      </Text>
      <Text style={styles.title}>Create your account</Text>

      {fields.map(({ name, label, secure, keyboardType }) => (
        <View key={name}>
          <Text style={styles.label}>{label}</Text>
          <Controller
            control={control}
            name={name}
            render={({ field: { onChange, value } }) =>
              secure ? (
                <PasswordField
                  style={styles.input}
                  value={value}
                  onChangeText={onChange}
                  autoCapitalize="none"
                  keyboardType={keyboardType ?? "default"}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={onChange}
                  autoCapitalize="none"
                  keyboardType={keyboardType ?? "default"}
                />
              )
            }
          />
          {errors[name] && <Text style={styles.error}>{errors[name]?.message as string}</Text>}
        </View>
      ))}

      {serverError && <Text style={styles.error}>{serverError}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>
        <Text style={styles.buttonText}>{isSubmitting ? "Creating account…" : "Sign up"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/login")}>
        <Text style={styles.link}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 28, justifyContent: "center", backgroundColor: colors.paper },
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

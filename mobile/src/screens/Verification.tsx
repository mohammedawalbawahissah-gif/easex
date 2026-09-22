import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView, StyleSheet, Alert } from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as ImagePicker from "expo-image-picker";
import {
  submitKYCSchema,
  type SubmitKYCFormValues,
  type KYCIdType,
  type KYCSubmission,
  type RNFilePart,
  ApiError,
} from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../theme";

const ID_TYPES: { value: KYCIdType; label: string }[] = [
  { value: "national_id", label: "National ID (Ghana Card)" },
  { value: "passport", label: "Passport" },
  { value: "voters_id", label: "Voter's ID" },
  { value: "drivers_license", label: "Driver's License" },
];

function statusLabel(status: string) {
  const labels: Record<string, string> = { pending: "Under review", approved: "Approved", rejected: "Rejected" };
  return labels[status] ?? status;
}

async function pickImage(): Promise<RNFilePart | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Photo access needed", "Allow photo library access in Settings to attach a photo.");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `kyc-${Date.now()}.jpg`,
    type: asset.mimeType ?? "image/jpeg",
  };
}

function ImagePickField({
  label,
  value,
  onPick,
}: {
  label: string;
  value: RNFilePart | null;
  onPick: (v: RNFilePart) => void;
}) {
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.imagePickerButton}
        onPress={async () => {
          const picked = await pickImage();
          if (picked) onPick(picked);
        }}
      >
        <Text style={styles.imagePickerText}>{value ? "Change photo" : "Attach photo"}</Text>
      </TouchableOpacity>
      {value && <Image source={{ uri: value.uri }} style={styles.preview} />}
    </View>
  );
}

export default function VerificationScreen() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState<KYCSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [front, setFront] = useState<RNFilePart | null>(null);
  const [back, setBack] = useState<RNFilePart | null>(null);
  const [selfie, setSelfie] = useState<RNFilePart | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubmitKYCFormValues>({ resolver: zodResolver(submitKYCSchema) });

  const loadSubmissions = useCallback(async () => {
    try {
      setSubmissions(await easex.kyc.list());
    } catch {
      // Non-fatal — the form still works even if history fails to load.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const hasPending = submissions.some((s) => s.status === "pending");
  const isFull = user?.kyc_tier === "full";

  const onSubmit = async (values: SubmitKYCFormValues) => {
    setServerError(null);
    setSuccessMsg(null);
    if (!front || !selfie) {
      setServerError("A photo of your ID and a selfie are both required.");
      return;
    }
    try {
      await easex.kyc.submit({
        ...values,
        id_document_front: front,
        selfie,
        ...(back ? { id_document_back: back } : {}),
      });
      setSuccessMsg("Submitted — we'll review it and let you know the outcome.");
      reset();
      setFront(null);
      setBack(null);
      setSelfie(null);
      loadSubmissions();
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === "object" && "non_field_errors" in err.body) {
        setServerError((err.body as { non_field_errors: string[] }).non_field_errors[0]);
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Verify your account</Text>
      <Text style={styles.subtitle}>Full verification raises your transaction limit to 50,000 GHS.</Text>

      {isFull ? (
        <Text style={styles.success}>You're fully verified. Nothing more to do here.</Text>
      ) : hasPending ? (
        <Text style={styles.muted}>
          Your submission is under review — we'll notify you once it's been checked.
        </Text>
      ) : (
        <>
          <Text style={styles.label}>Full legal name</Text>
          <Controller
            control={control}
            name="full_name"
            render={({ field: { onChange, value } }) => (
              <TextInput style={styles.input} value={value} onChangeText={onChange} />
            )}
          />
          {errors.full_name && <Text style={styles.error}>{errors.full_name.message}</Text>}

          <Text style={styles.label}>Date of birth (YYYY-MM-DD)</Text>
          <Controller
            control={control}
            name="date_of_birth"
            render={({ field: { onChange, value } }) => (
              <TextInput style={styles.input} value={value} onChangeText={onChange} placeholder="1995-01-01" />
            )}
          />
          {errors.date_of_birth && <Text style={styles.error}>{errors.date_of_birth.message}</Text>}

          <Text style={styles.label}>ID type</Text>
          <View style={styles.brandGrid}>
            <Controller
              control={control}
              name="id_type"
              render={({ field: { onChange, value } }) => (
                <>
                  {ID_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t.value}
                      style={[styles.chip, value === t.value && styles.chipSelected]}
                      onPress={() => onChange(t.value)}
                    >
                      <Text style={[styles.chipText, value === t.value && styles.chipTextSelected]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            />
          </View>
          {errors.id_type && <Text style={styles.error}>{errors.id_type.message}</Text>}

          <Text style={styles.label}>ID number</Text>
          <Controller
            control={control}
            name="id_number"
            render={({ field: { onChange, value } }) => (
              <TextInput style={styles.input} value={value} onChangeText={onChange} autoCapitalize="characters" />
            )}
          />
          {errors.id_number && <Text style={styles.error}>{errors.id_number.message}</Text>}

          <ImagePickField label="Photo of ID — front" value={front} onPick={setFront} />
          <ImagePickField label="Photo of ID — back (optional, e.g. not needed for a passport)" value={back} onPick={setBack} />
          <ImagePickField label="Selfie — hold your ID next to your face" value={selfie} onPick={setSelfie} />

          {serverError && <Text style={styles.error}>{serverError}</Text>}
          {successMsg && <Text style={styles.success}>{successMsg}</Text>}

          <TouchableOpacity style={styles.button} onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>
            <Text style={styles.buttonText}>{isSubmitting ? "Submitting…" : "Submit for review"}</Text>
          </TouchableOpacity>
        </>
      )}

      {!loading && submissions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Submission history</Text>
          <View style={styles.passbook}>
            {submissions.map((s) => (
              <View key={s.id} style={styles.row}>
                <View style={{ gap: 4, flexShrink: 1 }}>
                  <Text style={styles.rowTitle}>{statusLabel(s.status)}</Text>
                  {s.status === "rejected" && !!s.rejection_reason && (
                    <Text style={styles.rowMeta}>{s.rejection_reason}</Text>
                  )}
                </View>
                <Text style={styles.rowMeta}>
                  {new Date(s.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 2, marginBottom: 20 },
  muted: { fontFamily: fonts.bodyRegular, color: colors.inkSoft },
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
  brandGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 100, paddingVertical: 8, paddingHorizontal: 14 },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  chipTextSelected: { color: colors.paper },
  imagePickerButton: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    padding: 12,
    alignItems: "center",
  },
  imagePickerText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  preview: { width: 120, height: 90, borderRadius: 6, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginTop: 6, fontSize: 13 },
  success: { fontFamily: fonts.bodyRegular, color: colors.success, marginTop: 6, fontSize: 14 },
  button: { backgroundColor: colors.gold, padding: 14, borderRadius: 6, marginTop: 24, alignItems: "center" },
  buttonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 15 },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 32, marginBottom: 12 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
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
});

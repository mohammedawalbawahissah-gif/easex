import { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, StyleSheet, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  submitGiftCardSchema,
  type SubmitGiftCardFormValues,
  type GiftCardBrand,
  type GiftCardCategory,
  type GiftCardSubmission,
  type RNFilePart,
  GIFTCARD_CATEGORY_ORDER,
  apiErrorMessage,
  brandGlyph,
  estimateGiftCardPayout,
  faceValueProblem,
  filterBrands,
  subcategoryLabel,
} from "@easex/shared";
import { easex } from "../lib/easexClient";
import { colors, fonts, statusColors, statusLabel } from "../theme";
import ChartCard from "../components/ChartCard";
import SparkChart from "../components/SparkChart";
import FilterChips from "../components/FilterChips";
import BrandIcon from "../components/BrandIcon";
import { Dropdown, Message } from "../components/ui";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GiftCardsScreen() {
  const router = useRouter();
  const [brands, setBrands] = useState<GiftCardBrand[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [submissions, setSubmissions] = useState<GiftCardSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cardImage, setCardImage] = useState<RNFilePart | null>(null);
  const [extraFiles, setExtraFiles] = useState<RNFilePart[]>([]);

  // Step 1: which brand tile is open. Step 2: which subcategory (in the form).
  const [brandSlug, setBrandSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GiftCardCategory | "">("");

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SubmitGiftCardFormValues>({
    resolver: zodResolver(submitGiftCardSchema),
    defaultValues: { subcategory: "", card_code: "", face_value: "" },
  });

  const loadSubmissions = useCallback(async () => {
    try {
      setSubmissions(await easex.giftcards.list());
    } catch {
      // Non-fatal — submitting still works if history fails to load.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    easex.giftcards
      .catalog()
      .then((c) => {
        setBrands(c.brands);
        setCatalogState("ready");
      })
      .catch(() => setCatalogState("error"));
  }, []);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const brand = brands.find((b) => b.slug === brandSlug) ?? null;
  const subcategoryId = watch("subcategory");
  const faceValue = watch("face_value") ?? "";
  const sub = brand?.subcategories.find((s) => s.id === subcategoryId) ?? null;

  // History rows only carry the brand slug, so look the colour up from the catalog.
  const brandBySlug = useMemo(() => new Map(brands.map((b) => [b.slug, b])), [brands]);
  const visibleBrands = useMemo(() => filterBrands(brands, query, category), [brands, query, category]);
  const categoryOptions = useMemo(
    () => [
      { value: "", label: "All" },
      ...GIFTCARD_CATEGORY_ORDER.filter((c) => brands.some((b) => b.category === c)).map((c) => ({
        value: c,
        label: brands.find((b) => b.category === c)?.category_label ?? c,
      })),
    ],
    [brands]
  );

  const estimate = sub ? estimateGiftCardPayout(faceValue, sub.rate) : null;
  const valueProblem = sub && faceValue ? faceValueProblem(faceValue, sub) : null;

  const pickBrand = (slug: string) => {
    setBrandSlug(slug);
    setValue("subcategory", "");
    setServerError(null);
    setSuccessMsg(null);
  };

  const changeBrand = () => {
    setBrandSlug(null);
    setValue("subcategory", "");
    setServerError(null);
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Allow photo library access in Settings to attach a card image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    // React Native's fetch/FormData expects this {uri, name, type} shape
    // for file uploads — there's no real File/Blob object on-device.
    setCardImage({
      uri: asset.uri,
      name: asset.fileName ?? `card-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    });
  };

  const pickExtraFiles = async () => {
    // DocumentPicker opens the system file browser — Files on iOS (which
    // itself offers Photos, iCloud Drive, and other apps as sources) and
    // the equivalent on Android — rather than jumping straight into the
    // photo gallery, and it can pick a PDF here too, unlike the image
    // picker used above for the card photo.
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "video/*", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const picked: RNFilePart[] = result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name || "attachment",
      type: asset.mimeType || "application/octet-stream",
    }));
    setExtraFiles((files) => [...files, ...picked].slice(0, 6));
  };

  const removeExtraFile = (index: number) => {
    setExtraFiles((files) => files.filter((_, i) => i !== index));
  };

  const onSubmit = async (values: SubmitGiftCardFormValues) => {
    setServerError(null);
    setSuccessMsg(null);
    if (sub && faceValueProblem(values.face_value, sub)) return;
    try {
      await easex.giftcards.submit({
        ...values,
        ...(cardImage ? { card_image: cardImage } : {}),
        ...(extraFiles.length > 0 ? { images: extraFiles } : {}),
      });
      setSuccessMsg("Card submitted — we'll review it and update the status below.");
      reset({ subcategory: "", card_code: "", face_value: "" });
      setBrandSlug(null);
      setCardImage(null);
      setExtraFiles([]);
      loadSubmissions();
    } catch (err) {
      setServerError(apiErrorMessage(err, "Something went wrong. Please try again."));
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Sell a gift card</Text>
      <Text style={styles.subtitle}>
        Pick the card, then the exact type. Approved earnings go to your wallet — or straight to mobile money with{" "}
        <Text style={{ color: colors.indigo }} onPress={() => router.push("/(tabs)/payouts")}>automatic payouts</Text>.
      </Text>

      {!!successMsg && <Message kind="success">{successMsg}</Message>}
      {catalogState === "loading" && <Text style={styles.muted}>Loading cards…</Text>}
      {catalogState === "error" && <Message kind="error">Couldn't load the gift card list. Please try again.</Message>}

      {catalogState === "ready" && !brand && (
        <View>
          <TextInput
            style={styles.input}
            placeholder="Search gift cards…"
            placeholderTextColor={colors.inkSoft}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search gift cards"
          />
          <View style={{ marginTop: 10 }}>
            <FilterChips options={categoryOptions} value={category} onChange={(v) => setCategory(v as GiftCardCategory | "")} />
          </View>

          {visibleBrands.length === 0 ? (
            <Text style={styles.muted}>No gift cards match “{query}”.</Text>
          ) : (
            <View style={styles.brandGrid}>
              {visibleBrands.map((b) => (
                <TouchableOpacity
                  key={b.slug}
                  style={[styles.brandCard, { backgroundColor: b.color_from }]}
                  onPress={() => pickBrand(b.slug)}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.name} gift card`}
                >
                  <View style={styles.brandCardMonogram}>
                    <Text style={styles.brandCardMonogramText}>{brandGlyph(b.name)}</Text>
                  </View>
                  <View>
                    <Text style={styles.brandCardTag}>Gift card</Text>
                    <Text style={styles.brandCardName} numberOfLines={2}>{b.name}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {brand && (
        <View style={styles.tradePanel}>
          <TouchableOpacity onPress={changeBrand}>
            <Text style={styles.tradePanelClose}>← Choose a different card</Text>
          </TouchableOpacity>

          <View style={styles.selectedBrand}>
            <View style={[styles.swatch, { backgroundColor: brand.color_from }]}>
              <Text style={styles.swatchText}>{brandGlyph(brand.name)}</Text>
            </View>
            <Text style={styles.selectedBrandName}>{brand.name}</Text>
          </View>

          {/* Step 2 — the subcategory drop-down */}
          <Controller
            control={control}
            name="subcategory"
            render={({ field: { onChange, value } }) => (
              <Dropdown
                label="Card type"
                placeholder="Select the card type…"
                value={value}
                onChange={onChange}
                error={errors.subcategory?.message}
                options={brand.subcategories.map((s) => ({
                  value: s.id,
                  label: subcategoryLabel(s),
                  sublabel: s.available ? `GHS ${Number(s.rate)} per 1 ${s.currency}` : undefined,
                  disabled: !s.available,
                }))}
              />
            )}
          />
          {!!sub?.help_text && <Text style={styles.hint}>{sub.help_text}</Text>}

          {/* Step 3 — card details, once a type is chosen */}
          {sub && (
            <View>
              <Text style={styles.label}>Card value ({sub.currency})</Text>
              <Controller
                control={control}
                name="face_value"
                render={({ field: { onChange, value } }) => (
                  <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="100.00" />
                )}
              />
              {errors.face_value && <Text style={styles.error}>{errors.face_value.message}</Text>}
              {!!valueProblem && <Text style={styles.error}>{valueProblem}</Text>}

              <View style={styles.estimate}>
                <Text style={styles.estimateText}>
                  Rate: GHS {Number(sub.rate)} per 1 {sub.currency}
                  {estimate !== null ? ` · You'll receive about GHS ${money(estimate)}` : ""}
                </Text>
              </View>

              <Text style={styles.label}>Card code</Text>
              <Controller
                control={control}
                name="card_code"
                render={({ field: { onChange, value } }) => (
                  <TextInput style={styles.input} value={value} onChangeText={onChange} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX-XXXX" />
                )}
              />
              {errors.card_code && <Text style={styles.error}>{errors.card_code.message}</Text>}

              <Text style={styles.label}>Photo of the card (optional, but speeds up review)</Text>
              <TouchableOpacity style={styles.imagePickerButton} onPress={pickImage}>
                <Text style={styles.imagePickerText}>{cardImage ? "Change photo" : "Attach photo"}</Text>
              </TouchableOpacity>
              {cardImage && <Image source={{ uri: cardImage.uri }} style={styles.preview} />}

              <Text style={styles.label}>Additional evidence (optional) — up to 6 photos or videos</Text>
              <TouchableOpacity style={styles.imagePickerButton} onPress={pickExtraFiles}>
                <Text style={styles.imagePickerText}>Add files</Text>
              </TouchableOpacity>
              {extraFiles.length > 0 && (
                <View style={{ marginTop: 8, gap: 6 }}>
                  {extraFiles.map((f, i) => (
                    <View key={`${f.uri}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontFamily: fonts.bodyRegular, fontSize: 12.5, color: colors.ink, flex: 1 }} numberOfLines={1}>
                        {f.name}
                      </Text>
                      <TouchableOpacity onPress={() => removeExtraFile(i)}>
                        <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.danger }}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {serverError && <Text style={styles.error}>{serverError}</Text>}

              <TouchableOpacity style={[styles.button, (isSubmitting || !!valueProblem) && { opacity: 0.55 }]} onPress={handleSubmit(onSubmit)} disabled={isSubmitting || !!valueProblem}>
                <Text style={styles.buttonText}>{isSubmitting ? "Submitting…" : "Submit card"}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Your submissions</Text>

      {submissions.length > 0 && (
        <ChartCard title="Payout value over time (GHS)">
          <SparkChart
            kind="bar"
            points={submissions
              .slice()
              .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())
              .map((s) => ({
                label: new Date(s.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                value: Number(s.verified_value ?? s.estimated_payout),
              }))}
            valueFormatter={(v) => `GHS ${money(v)}`}
          />
        </ChartCard>
      )}

      <View style={styles.passbook}>
        {loading ? (
          <Text style={styles.emptyRow}>Loading…</Text>
        ) : submissions.length === 0 ? (
          <Text style={styles.emptyRow}>No submissions yet.</Text>
        ) : (
          submissions.map((s) => {
            const sc = statusColors[s.transaction_status] ?? { bg: colors.line, fg: colors.inkSoft };
            return (
              <View key={s.id} style={styles.row}>
                <View style={styles.rowBrand}>
                  <BrandIcon name={s.brand_name} from={brandBySlug.get(s.brand)?.color_from} size={34} />
                  <View style={{ gap: 4, flexShrink: 1 }}>
                    <Text style={styles.rowTitle}>{s.brand_name}</Text>
                    {!!s.subcategory_name && <Text style={styles.rowMeta}>{s.subcategory_name}</Text>}
                    <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                      <View style={[styles.statusDot, { backgroundColor: sc.fg }]} />
                      <Text style={[styles.statusText, { color: sc.fg }]}>{statusLabel(s.transaction_status)}</Text>
                    </View>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.rowAmount}>{money(Number(s.face_value))} {s.card_currency}</Text>
                  <Text style={styles.rowMeta}>≈ GHS {money(Number(s.verified_value ?? s.estimated_payout))}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { padding: 24, paddingBottom: 48 },
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink },
  subtitle: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginTop: 2, marginBottom: 20 },
  muted: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft, marginVertical: 16 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSoft, marginBottom: 6, marginTop: 14 },
  hint: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft, marginTop: -8, marginBottom: 8 },
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
  brandGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  brandCard: {
    width: "31%",
    aspectRatio: 1.5,
    borderRadius: 10,
    padding: 10,
    justifyContent: "space-between",
  },
  brandCardTag: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    color: "rgba(255,255,255,0.75)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  brandCardMonogram: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  brandCardMonogramText: { fontFamily: fonts.displaySemiBold, fontSize: 11, color: "#fff" },
  brandCardName: { fontFamily: fonts.displaySemiBold, fontSize: 13, color: "#fff" },
  tradePanel: { marginTop: 4, paddingTop: 4 },
  tradePanelClose: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.goldDeep, paddingTop: 4, paddingBottom: 4 },
  selectedBrand: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, marginBottom: 18 },
  swatch: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  swatchText: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: "#fff" },
  selectedBrandName: { fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink },
  estimate: { backgroundColor: colors.paperRaised, borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 10, marginTop: 12 },
  estimateText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.ink },
  imagePickerButton: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    padding: 12,
    alignItems: "center",
  },
  imagePickerText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  preview: { width: 120, height: 80, borderRadius: 6, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  error: { fontFamily: fonts.bodyRegular, color: colors.danger, marginTop: 6, fontSize: 13 },
  button: { backgroundColor: colors.gold, padding: 14, borderRadius: 6, marginTop: 24, alignItems: "center" },
  buttonText: { fontFamily: fonts.bodySemiBold, color: "#17130A", fontSize: 15 },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 32, marginBottom: 12 },
  passbook: { borderTopWidth: 1, borderTopColor: colors.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowBrand: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  rowMeta: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft },
  rowAmount: { fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.ink },
  emptyRow: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, fontSize: 14, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 3, paddingHorizontal: 9, borderRadius: 100 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
});

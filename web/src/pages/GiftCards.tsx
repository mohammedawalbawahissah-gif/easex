import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  submitGiftCardSchema,
  type SubmitGiftCardFormValues,
  type GiftCardBrand,
  type GiftCardCategory,
  type GiftCardSubmission,
  GIFTCARD_CATEGORY_ORDER,
  apiErrorMessage,
  brandGlyph,
  estimateGiftCardPayout,
  faceValueProblem,
  filterBrands,
  subcategoryLabel,
} from "@easex/shared";
import { easex } from "../lib/easexClient";
import AppShell from "../components/AppShell";
import SparkChart from "../components/SparkChart";
import BrandIcon from "../components/BrandIcon";

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pending",
    under_review: "Under review",
    verified: "Approved — payment on the way",
    settled: "Paid",
    rejected: "Rejected",
    flagged: "Under compliance review",
  };
  return labels[status] ?? status;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — matches a sane upload limit
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GiftCards() {
  const [brands, setBrands] = useState<GiftCardBrand[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [submissions, setSubmissions] = useState<GiftCardSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cardImage, setCardImage] = useState<File | null>(null);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Step 1: which brand tile is open. Step 2: which subcategory (in the form).
  const [brandSlug, setBrandSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GiftCardCategory | "">("");

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SubmitGiftCardFormValues>({ resolver: zodResolver(submitGiftCardSchema), defaultValues: { subcategory: "" } });

  useEffect(() => {
    easex.giftcards
      .catalog()
      .then((c) => {
        setBrands(c.brands);
        setCatalogState("ready");
      })
      .catch(() => setCatalogState("error"));
  }, []);

  const loadSubmissions = async () => {
    try {
      setSubmissions(await easex.giftcards.list());
    } catch {
      // Non-fatal — the submit form still works even if history fails to load.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubmissions();
  }, []);

  // Revoke the object URL when it's replaced or the component unmounts,
  // so we don't leak memory across repeated selections.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const brand = brands.find((b) => b.slug === brandSlug) ?? null;
  const subcategoryId = watch("subcategory");
  const faceValue = watch("face_value") ?? "";
  const sub = brand?.subcategories.find((s) => s.id === subcategoryId) ?? null;

  // History rows only carry the brand slug, so look the colours up from the catalog.
  const brandBySlug = useMemo(() => new Map(brands.map((b) => [b.slug, b])), [brands]);
  const visibleBrands = useMemo(() => filterBrands(brands, query, category), [brands, query, category]);
  const presentCategories = useMemo(
    () => GIFTCARD_CATEGORY_ORDER.filter((c) => brands.some((b) => b.category === c)),
    [brands]
  );
  const categoryLabel = (c: GiftCardCategory) => brands.find((b) => b.category === c)?.category_label ?? c;

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

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setCardImage(null);
      setPreviewUrl(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError("Please choose a JPEG, PNG, or WEBP image.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image is too large — please keep it under 5MB.");
      e.target.value = "";
      return;
    }
    setCardImage(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleExtraFilesPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const combined = [...extraFiles, ...files].slice(0, 6);
    const oversized = combined.find((f) => f.size > MAX_IMAGE_BYTES);
    if (oversized) {
      setImageError(`"${oversized.name}" is too large — please keep each file under 5MB.`);
      e.target.value = "";
      return;
    }
    setExtraFiles(combined);
    e.target.value = ""; // lets picking the same file again re-trigger onChange
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
      setPreviewUrl(null);
      setExtraFiles([]);
      loadSubmissions();
    } catch (err) {
      setServerError(apiErrorMessage(err, "Something went wrong. Please try again."));
    }
  };

  return (
    <AppShell>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Sell a gift card</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 24 }}>
        Pick the card, then the exact type. Approved earnings go to your wallet — or straight to mobile money if you turn on{" "}
        <Link to="/payouts">automatic payouts</Link>.
      </p>

      {successMsg && <p className="success-box">{successMsg}</p>}

      {catalogState === "loading" && <p style={{ color: "var(--ink-soft)" }}>Loading cards…</p>}
      {catalogState === "error" && <p className="form-error" role="alert">Couldn't load the gift card list. Please refresh.</p>}

      {catalogState === "ready" && !brand && (
        <div>
          <div className="brand-toolbar">
            <input
              type="search"
              aria-label="Search gift cards"
              placeholder="Search gift cards…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%" }}
            />
            <div className="chip-row" role="group" aria-label="Filter by category">
              <button type="button" className="chip" aria-pressed={category === ""} onClick={() => setCategory("")}>All</button>
              {presentCategories.map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>

          {visibleBrands.length === 0 ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>No gift cards match “{query}”.</p>
          ) : (
            <div className="brand-card-grid" role="list">
              {visibleBrands.map((b) => (
                <button
                  key={b.slug}
                  type="button"
                  role="listitem"
                  className="brand-card"
                  style={{ background: `linear-gradient(135deg, ${b.color_from}, ${b.color_to})` }}
                  onClick={() => pickBrand(b.slug)}
                >
                  <span className="brand-card-monogram">{brandGlyph(b.name)}</span>
                  <span>
                    <span className="brand-card-tag">Gift card</span>
                    <span className="brand-card-name" style={{ display: "block" }}>{b.name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {brand && (
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="trade-panel">
            <button type="button" className="trade-panel-close" onClick={changeBrand}>
              ← Choose a different card
            </button>

            <div className="selected-brand">
              <span
                className="selected-brand-monogram"
                style={{ background: `linear-gradient(135deg, ${brand.color_from}, ${brand.color_to})` }}
              >
                {brandGlyph(brand.name)}
              </span>
              <strong style={{ fontSize: 18 }}>{brand.name}</strong>
            </div>

            {/* Step 2 — the subcategory drop-down */}
            <div className="field">
              <label htmlFor="subcategory">Card type</label>
              <select id="subcategory" {...register("subcategory")}>
                <option value="">Select the card type…</option>
                {brand.subcategories.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.available}>
                    {subcategoryLabel(s)}
                  </option>
                ))}
              </select>
              {errors.subcategory && <p className="field-error">{errors.subcategory.message}</p>}
              {sub?.help_text && <p className="hint" style={{ margin: "6px 0 0" }}>{sub.help_text}</p>}
            </div>

            {/* Step 3 — card details, once a type is chosen */}
            {sub && (
              <div>
                <div className="field">
                  <label htmlFor="face_value">Card value ({sub.currency})</label>
                  <input id="face_value" {...register("face_value")} inputMode="decimal" placeholder="100.00" />
                  {errors.face_value && <p className="field-error">{errors.face_value.message}</p>}
                  {valueProblem && <p className="field-error">{valueProblem}</p>}
                </div>

                <div className="estimate-box">
                  Rate: <strong>GHS {Number(sub.rate)} per 1 {sub.currency}</strong>
                  {estimate !== null && (
                    <>
                      {" "}· You'll receive about <strong>GHS {money(estimate)}</strong>
                    </>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="card_code">Card code</label>
                  <input id="card_code" {...register("card_code")} placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
                  {errors.card_code && <p className="field-error">{errors.card_code.message}</p>}
                </div>

                <div className="field">
                  <label htmlFor="card_image">Photo of the card (optional, but speeds up review)</label>
                  <input id="card_image" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImagePick} />
                  {imageError && <p className="field-error">{imageError}</p>}
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="Card preview"
                      style={{ marginTop: 8, maxWidth: 200, borderRadius: 6, border: "1px solid var(--line)" }}
                    />
                  )}
                </div>

                <div className="field">
                  <label htmlFor="extra_files">Additional evidence (optional) — up to 6 images, videos, or a PDF</label>
                  <input
                    id="extra_files"
                    type="file"
                    multiple
                    // No narrow `accept` here either, for the same reason as the chat attachment input.
                    onChange={handleExtraFilesPick}
                  />
                  {extraFiles.length > 0 && (
                    <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13 }}>
                      {extraFiles.map((f, i) => (
                        <li key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span>{f.name}</span>
                          <button
                            type="button"
                            onClick={() => removeExtraFile(i)}
                            className="btn-secondary"
                            style={{ padding: "1px 8px", fontSize: 11 }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {serverError && <p className="form-error" role="alert">{serverError}</p>}

                <button type="submit" className="btn-primary" disabled={isSubmitting || !!valueProblem}>
                  {isSubmitting ? "Submitting…" : "Submit card"}
                </button>
              </div>
            )}
          </div>
        </form>
      )}

      <h2 className="section-title">Your submissions</h2>

      {submissions.length > 0 && (
        <div className="chart-card">
          <div className="chart-card-title">Payout value over time (GHS)</div>
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
        </div>
      )}

      <div className="passbook">
        {loading ? (
          <div className="empty-row">Loading…</div>
        ) : submissions.length === 0 ? (
          <div className="empty-row">No submissions yet.</div>
        ) : (
          submissions.map((s) => (
            <div className="passbook-row" key={s.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <BrandIcon name={s.brand_name} from={brandBySlug.get(s.brand)?.color_from} to={brandBySlug.get(s.brand)?.color_to} size={34} />
                <div className="passbook-row-main">
                  <span className="passbook-row-title">{s.brand_name}</span>
                  {s.subcategory_name && <span className="passbook-row-meta">{s.subcategory_name}</span>}
                  <span className={`status-pill status-${s.transaction_status}`}>{statusLabel(s.transaction_status)}</span>
                </div>
              </div>
              <span className="passbook-row-amount">
                {money(Number(s.face_value))} {s.card_currency}
                <span className="passbook-row-meta" style={{ display: "block", textAlign: "right" }}>
                  ≈ GHS {money(Number(s.verified_value ?? s.estimated_payout))}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

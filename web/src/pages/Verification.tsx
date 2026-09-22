import { useEffect, useState, type ChangeEvent } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { submitKYCSchema, type SubmitKYCFormValues, type KYCIdType, type KYCSubmission, ApiError } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import AppShell from "../components/AppShell";

const ID_TYPES: { value: KYCIdType; label: string }[] = [
  { value: "national_id", label: "National ID (Ghana Card)" },
  { value: "passport", label: "Passport" },
  { value: "voters_id", label: "Voter's ID" },
  { value: "drivers_license", label: "Driver's License" },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Under review",
    approved: "Approved",
    rejected: "Rejected",
  };
  return labels[status] ?? status;
}

function useImagePicker() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError("Please choose a JPEG, PNG, or WEBP image.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setError("Image is too large — please keep it under 5MB.");
      e.target.value = "";
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setError(null);
  };

  return { file, error, previewUrl, onChange, reset };
}

export default function Verification() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState<KYCSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const front = useImagePicker();
  const back = useImagePicker();
  const selfie = useImagePicker();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubmitKYCFormValues>({ resolver: zodResolver(submitKYCSchema) });

  const loadSubmissions = async () => {
    try {
      setSubmissions(await easex.kyc.list());
    } catch {
      // Non-fatal — the form still works even if history fails to load.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubmissions();
  }, []);

  const hasPending = submissions.some((s) => s.status === "pending");
  const isFull = user?.kyc_tier === "full";

  const onSubmit = async (values: SubmitKYCFormValues) => {
    setServerError(null);
    setSuccessMsg(null);
    if (!front.file || !selfie.file) {
      setServerError("A photo of your ID and a selfie are both required.");
      return;
    }
    try {
      await easex.kyc.submit({
        ...values,
        id_document_front: front.file,
        selfie: selfie.file,
        ...(back.file ? { id_document_back: back.file } : {}),
      });
      setSuccessMsg("Submitted — we'll review it and let you know the outcome.");
      reset();
      front.reset();
      back.reset();
      selfie.reset();
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
    <AppShell>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Verify your account</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 24 }}>
        Full verification raises your transaction limit to 50,000 GHS.
      </p>

      {isFull ? (
        <p style={{ color: "var(--success)", fontSize: 14 }}>You're fully verified. Nothing more to do here.</p>
      ) : hasPending ? (
        <p style={{ color: "var(--ink-soft)" }}>
          Your submission is under review — we'll notify you once it's been checked.
        </p>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="field">
            <label htmlFor="full_name">Full legal name</label>
            <input id="full_name" {...register("full_name")} />
            {errors.full_name && <span className="field-error">{errors.full_name.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="date_of_birth">Date of birth</label>
            <input id="date_of_birth" type="date" {...register("date_of_birth")} />
            {errors.date_of_birth && <span className="field-error">{errors.date_of_birth.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="id_type">ID type</label>
            <Controller
              control={control}
              name="id_type"
              render={({ field }) => (
                <select id="id_type" {...field} defaultValue="">
                  <option value="" disabled>
                    Choose an ID type
                  </option>
                  {ID_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
            />
            {errors.id_type && <span className="field-error">{errors.id_type.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="id_number">ID number</label>
            <input id="id_number" {...register("id_number")} />
            {errors.id_number && <span className="field-error">{errors.id_number.message}</span>}
          </div>

          <div className="field">
            <label htmlFor="id_front">Photo of ID — front</label>
            <input id="id_front" type="file" accept="image/jpeg,image/png,image/webp" onChange={front.onChange} />
            {front.error && <span className="field-error">{front.error}</span>}
            {front.previewUrl && <img src={front.previewUrl} alt="ID front preview" className="kyc-preview" />}
          </div>

          <div className="field">
            <label htmlFor="id_back">Photo of ID — back (optional, e.g. not needed for a passport)</label>
            <input id="id_back" type="file" accept="image/jpeg,image/png,image/webp" onChange={back.onChange} />
            {back.error && <span className="field-error">{back.error}</span>}
            {back.previewUrl && <img src={back.previewUrl} alt="ID back preview" className="kyc-preview" />}
          </div>

          <div className="field">
            <label htmlFor="selfie">Selfie — hold your ID next to your face</label>
            <input id="selfie" type="file" accept="image/jpeg,image/png,image/webp" onChange={selfie.onChange} />
            {selfie.error && <span className="field-error">{selfie.error}</span>}
            {selfie.previewUrl && <img src={selfie.previewUrl} alt="Selfie preview" className="kyc-preview" />}
          </div>

          {serverError && <p className="form-error" role="alert">{serverError}</p>}
          {successMsg && <p style={{ color: "var(--success)", fontSize: 14 }}>{successMsg}</p>}

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Submitting…" : "Submit for review"}
          </button>
        </form>
      )}

      {!loading && submissions.length > 0 && (
        <>
          <h2 className="section-title">Submission history</h2>
          <div className="passbook">
            {submissions.map((s) => (
              <div key={s.id} className="passbook-row">
                <div className="passbook-row-main">
                  <span className="passbook-row-title">{statusLabel(s.status)}</span>
                  {s.status === "rejected" && s.rejection_reason && (
                    <span className="passbook-row-meta">{s.rejection_reason}</span>
                  )}
                </div>
                <span className="passbook-row-meta">
                  {new Date(s.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}

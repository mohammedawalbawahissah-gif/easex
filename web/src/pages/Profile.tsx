import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema, type ChangePasswordFormValues, apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useAuth } from "../context/AuthContext";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import PasswordField from "../components/PasswordField";
import AppShell from "../components/AppShell";

const TIER_LABELS: Record<string, string> = {
  unverified: "Unverified",
  basic: "Basic",
  full: "Full",
};

const TIER_PILL_CLASS: Record<string, string> = {
  unverified: "status-rejected",
  basic: "status-pending",
  full: "status-verified",
};

const TIER_LIMITS: Record<string, string> = {
  unverified: "0 GHS",
  basic: "2,000 GHS",
  full: "50,000 GHS",
};

export default function Profile() {
  const { user, adoptTokens } = useAuth();
  const { status: security } = useSecurityStatus();
  const [otp, setOtp] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const {
    register,
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
      adoptTokens(result.tokens);
      setSuccessMsg("Password updated. Your other devices have been signed out.");
      setOtp("");
      reset();
    } catch (err) {
      setServerError(apiErrorMessage(err, "Something went wrong. Please try again."));
    }
  };

  if (!user) return null;

  return (
    <AppShell>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Account</h1>

      <h2 className="section-title">Security</h2>
      <div className="passbook">
        <div className="passbook-row">
          <span className="passbook-row-title">Transaction PIN</span>
          <span className="passbook-row-meta">{security ? (security.pin_set ? "Set" : "Not set") : "…"}</span>
        </div>
        <div className="passbook-row">
          <span className="passbook-row-title">Two-factor authentication</span>
          <span className="passbook-row-meta">{security ? (security.totp_enabled ? "On" : "Off") : "…"}</span>
        </div>
      </div>
      <p style={{ marginTop: 10 }}><Link to="/security">Manage PIN and two-factor authentication →</Link></p>

      <h2 className="section-title">Details</h2>
      <div className="passbook">
        <div className="passbook-row">
          <span className="passbook-row-title">Username</span>
          <span className="passbook-row-meta">{user.username}</span>
        </div>
        <div className="passbook-row">
          <span className="passbook-row-title">Email</span>
          <span className="passbook-row-meta">{user.email}</span>
        </div>
        <div className="passbook-row">
          <span className="passbook-row-title">Phone</span>
          <span className="passbook-row-meta">{user.phone_number || "—"}</span>
        </div>
        <div className="passbook-row">
          <span className="passbook-row-title">Verification tier</span>
          <span className={`status-pill ${TIER_PILL_CLASS[user.kyc_tier]}`}>
            {TIER_LABELS[user.kyc_tier]} · limit {TIER_LIMITS[user.kyc_tier]}
          </span>
        </div>
      </div>

      {user.kyc_tier !== "full" && (
        <Link to="/verification" className="btn-primary" style={{ display: "inline-block", textDecoration: "none", marginBottom: 8 }}>
          Verify your account
        </Link>
      )}

      <h2 className="section-title">Change password</h2>
      <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="old_password">Current password</label>
          <PasswordField
            id="old_password"
            {...register("old_password")}
            autoComplete="current-password"
          />
          {errors.old_password && <p className="field-error">{errors.old_password.message}</p>}
        </div>

        <div className="field">
          <label htmlFor="new_password">New password</label>
          <PasswordField
            id="new_password"
            {...register("new_password")}
            autoComplete="new-password"
          />
          {errors.new_password && <p className="field-error">{errors.new_password.message}</p>}
        </div>

        {security?.totp_enabled && (
          <div className="field">
            <label htmlFor="otp">Authenticator code</label>
            <input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
          </div>
        )}

        {serverError && <p className="form-error" role="alert">{serverError}</p>}
        {successMsg && <p style={{ color: "var(--success)", fontSize: 14 }}>{successMsg}</p>}

        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </AppShell>
  );
}

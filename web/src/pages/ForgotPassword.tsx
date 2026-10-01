import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordResetRequestSchema, type PasswordResetRequestFormValues } from "@easex/shared";
import { Link } from "react-router-dom";
import { easex } from "../lib/easexClient";
import AppIcon from "../components/AppIcon";

export default function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequestFormValues>({ resolver: zodResolver(passwordResetRequestSchema) });

  const onSubmit = async (values: PasswordResetRequestFormValues) => {
    // The backend always returns the same generic response regardless
    // of whether the email exists — that's intentional (prevents
    // account enumeration), so the UI shows one message either way.
    await easex.auth.requestPasswordReset(values);
    setSubmitted(true);
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="brand-hero">
          <AppIcon size={88} className="brand-hero-icon" />
          Ease<span className="brand-gold">X</span>
        </div>

        {submitted ? (
          <p style={{ textAlign: "left" }}>
            If that email is registered, we've sent a link to reset your password.
          </p>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <h1 style={{ fontSize: 22 }}>Reset your password</h1>
            <p className="auth-subtitle" style={{ marginBottom: 20 }}>
              Enter your email and we'll send you a reset link.
            </p>

            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" {...register("email")} autoComplete="email" />
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </div>

            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="form-footer">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  );
}

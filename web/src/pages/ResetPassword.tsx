import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordResetConfirmSchema, type PasswordResetConfirmFormValues, ApiError } from "@easex/shared";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { easex } from "../lib/easexClient";
import PasswordField from "../components/PasswordField";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetConfirmFormValues>({ resolver: zodResolver(passwordResetConfirmSchema) });

  const onSubmit = async (values: PasswordResetConfirmFormValues) => {
    setServerError(null);
    try {
      await easex.auth.confirmPasswordReset({ uid: uid!, token: token!, ...values });
      navigate("/login");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setServerError("This reset link is invalid or has expired. Request a new one.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  if (!uid || !token) {
    return (
      <div className="auth-page">
        <div className="auth-panel">
          <div className="brand-hero">
            Ease<span className="brand-gold">X</span>
          </div>
          <p className="form-error" role="alert">
            This reset link is missing required information.
          </p>
          <p className="form-footer">
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="brand-hero">
          Ease<span className="brand-gold">X</span>
        </div>
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <h1 style={{ fontSize: 22 }}>Set a new password</h1>

          <div className="field">
            <label htmlFor="new_password">New password</label>
            <PasswordField
              id="new_password"
              {...register("new_password")}
              autoComplete="new-password"
            />
            {errors.new_password && <p className="field-error">{errors.new_password.message}</p>}
          </div>

          {serverError && <p className="form-error" role="alert">{serverError}</p>}

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
    </div>
  );
}

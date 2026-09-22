import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterFormValues, ApiError } from "@easex/shared";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PasswordField from "../components/PasswordField";

export default function Register() {
  const { register: doRegister } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    try {
      await doRegister(values);
      navigate("/wallet");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setServerError("Please check your details — a field may already be in use.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="brand-hero">
          Ease<span className="brand-gold">X</span>
        </div>
        <h1 className="auth-subtitle">Create your account</h1>
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" {...register("username")} autoComplete="username" />
            {errors.username && <p className="field-error">{errors.username.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" {...register("email")} autoComplete="email" />
            {errors.email && <p className="field-error">{errors.email.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="phone_number">Phone number</label>
            <input
              id="phone_number"
              {...register("phone_number")}
              autoComplete="tel"
              placeholder="+233…"
            />
            {errors.phone_number && <p className="field-error">{errors.phone_number.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordField
              id="password"
              {...register("password")}
              autoComplete="new-password"
            />
            {errors.password && <p className="field-error">{errors.password.message}</p>}
          </div>

          {serverError && <p className="form-error" role="alert">{serverError}</p>}

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Sign up"}
          </button>

          <p className="form-footer">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

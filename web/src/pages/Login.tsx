import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginFormValues, ApiError, apiErrorMessage } from "@easex/shared";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PasswordField from "../components/PasswordField";

export default function Login() {
  const { login, completeMfaLogin } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  // Step 2 of sign-in, for accounts with two-factor authentication.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const {
    register,
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
      navigate("/wallet");
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

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setMfaBusy(true);
    setServerError(null);
    try {
      await completeMfaLogin(mfaToken, code.trim());
      navigate("/wallet");
    } catch (err) {
      const message = apiErrorMessage(err, "Something went wrong. Please try again.");
      setServerError(message);
      // An expired sign-in can't be retried with the same token: go back to the password step.
      if (err instanceof ApiError && (err.body as { code?: string } | undefined)?.code === "mfa_expired") setMfaToken(null);
    } finally {
      setMfaBusy(false);
    }
  };

  if (mfaToken) {
    return (
      <div className="auth-page">
        <div className="auth-panel">
          <div className="brand-hero">Ease<span className="brand-gold">X</span></div>
          <form className="auth-form" onSubmit={submitCode} noValidate>
            <p className="hint" style={{ margin: "0 0 12px" }}>
              Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes instead.
            </p>
            <div className="field">
              <label htmlFor="code">Authentication code</label>
              <input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" autoFocus />
            </div>
            {serverError && <p className="form-error" role="alert">{serverError}</p>}
            <button className="btn-primary" disabled={mfaBusy || !code}>{mfaBusy ? "Checking…" : "Verify"}</button>
            <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => { setMfaToken(null); setCode(""); setServerError(null); }}>Back</button>
          </form>
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
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" {...register("username")} autoComplete="username" />
            {errors.username && <p className="field-error">{errors.username.message}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordField
              id="password"
              {...register("password")}
              autoComplete="current-password"
            />
            {errors.password && <p className="field-error">{errors.password.message}</p>}
          </div>

          {serverError && <p className="form-error" role="alert">{serverError}</p>}

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Logging in…" : "Log in"}
          </button>

          <p className="form-footer">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>

          <p className="form-footer">
            Don't have an account? <Link to="/register">Sign up</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

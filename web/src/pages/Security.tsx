import { useState } from "react";
import { Link } from "react-router-dom";
import type { TotpSetup } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import PasswordField from "../components/PasswordField";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { useAuth } from "../context/AuthContext";
import AppShell from "../components/AppShell";

const digits = (v: string) => v.replace(/\D/g, "");

export default function Security() {
  const { status, refresh } = useSecurityStatus();
  const { adoptTokens } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // PIN form
  const [pinPassword, setPinPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinOtp, setPinOtp] = useState("");

  // 2FA flows
  const [enablePassword, setEnablePassword] = useState("");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [firstCode, setFirstCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [managePassword, setManagePassword] = useState("");
  const [manageCode, setManageCode] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const savePin = () =>
    run(async () => {
      if (pin !== confirmPin) throw new Error("mismatch");
      await easex.security.setPin({ pin, password: pinPassword, ...(status?.totp_enabled ? { otp: pinOtp.trim() } : {}) });
      setPin(""); setConfirmPin(""); setPinPassword(""); setPinOtp("");
      setNotice(status?.pin_set ? "PIN changed. For your security, money can't leave your account for the next 24 hours." : "PIN set. You can now send and withdraw.");
    }).then(() => undefined);

  const startSetup = () =>
    run(async () => {
      setSetup(await easex.security.twoFactor.setup(enablePassword));
      setEnablePassword("");
    });

  const confirmEnable = () =>
    run(async () => {
      const result = await easex.security.twoFactor.enable(firstCode.trim());
      adoptTokens(result.tokens); // every other session was signed out; this device stays in
      setRecoveryCodes(result.recovery_codes);
      setSetup(null);
      setFirstCode("");
    });

  const disable = () =>
    run(async () => {
      const result = await easex.security.twoFactor.disable(managePassword, manageCode.trim());
      adoptTokens(result.tokens);
      setManagePassword(""); setManageCode("");
      setNotice("Two-factor authentication is off. For your security, money can't leave your account for the next 24 hours.");
    });

  const regenerate = () =>
    run(async () => {
      const result = await easex.security.twoFactor.regenerateRecoveryCodes(managePassword, manageCode.trim());
      setRecoveryCodes(result.recovery_codes);
      setManagePassword(""); setManageCode("");
    });

  if (!status) return <AppShell><p style={{ color: "var(--ink-soft)" }}>Loading…</p></AppShell>;

  return (
    <AppShell>
      <Link to="/account" style={{ fontSize: 14, color: "var(--ink-soft)" }}>← Account</Link>
      <h1 style={{ fontSize: 22, margin: "16px 0 20px" }}>Security</h1>

      {error && <p className="form-error" role="alert">{error === "mismatch" ? "The PINs don't match." : error}</p>}
      {notice && <p className="success-box">{notice}</p>}
      {status.cooling_off_until && (
        <p className="warn-box">
          As a precaution, money can't leave your account until {new Date(status.cooling_off_until).toLocaleString()}.
        </p>
      )}
      {status.is_staff && !status.totp_enabled && (
        <p className="warn-box">Staff accounts must turn on two-factor authentication before using the admin tools.</p>
      )}

      {/* ---------------- PIN ---------------- */}
      <h2 className="section-title">Transaction PIN</h2>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        A 6-digit PIN confirms every send and withdrawal. {status.pin_set ? "Changing it pauses withdrawals for 24 hours." : "Set one to start moving money."}
      </p>
      <div className="auth-form">
        <div className="field">
          <label htmlFor="pinpw">Your password</label>
          <PasswordField id="pinpw" value={pinPassword} onChange={(e) => setPinPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="field">
          <label htmlFor="newpin">{status.pin_set ? "New PIN" : "PIN"} (6 digits)</label>
          <PasswordField id="newpin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(digits(e.target.value))} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="confirmpin">Confirm PIN</label>
          <PasswordField id="confirmpin" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(e) => setConfirmPin(digits(e.target.value))} autoComplete="off" />
        </div>
        {status.totp_enabled && (
          <div className="field">
            <label htmlFor="pinotp">Authenticator code</label>
            <input id="pinotp" inputMode="numeric" maxLength={6} value={pinOtp} onChange={(e) => setPinOtp(digits(e.target.value))} autoComplete="one-time-code" />
          </div>
        )}
        <button className="btn-primary" onClick={savePin} disabled={busy || !pinPassword || pin.length !== 6 || confirmPin.length !== 6 || (status.totp_enabled && pinOtp.length !== 6)}>
          {status.pin_set ? "Change PIN" : "Set PIN"}
        </button>
      </div>

      {/* ---------------- 2FA ---------------- */}
      <h2 className="section-title">Two-factor authentication</h2>

      {recoveryCodes && (
        <div className="warn-box">
          <strong>Save these recovery codes now.</strong> Each works once if you lose your phone. They will not be shown again.
          <div className="copy-box" style={{ marginTop: 10, whiteSpace: "pre-line" }}>{recoveryCodes.join("\n")}</div>
          <button className="btn-secondary" onClick={() => setRecoveryCodes(null)}>I've saved them</button>
        </div>
      )}

      {!status.totp_enabled && !setup && (
        <div className="auth-form">
          <p className="hint" style={{ margin: "0 0 12px" }}>
            Adds a code from an authenticator app (Google Authenticator, Authy, 1Password…) to sign-in, withdrawals and account changes.
          </p>
          <div className="field">
            <label htmlFor="epw">Your password</label>
            <PasswordField id="epw" value={enablePassword} onChange={(e) => setEnablePassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn-primary" onClick={startSetup} disabled={busy || !enablePassword}>Turn on</button>
        </div>
      )}

      {setup && (
        <div className="auth-form">
          <p style={{ fontSize: 14 }}>1. Add this key to your authenticator app (choose "enter a setup key"):</p>
          <div className="copy-box">{setup.secret}</div>
          <p className="hint">On a phone, <a href={setup.otpauth_uri}>tap here to open your authenticator app</a> with the key filled in.</p>
          <p style={{ fontSize: 14 }}>2. Enter the 6-digit code it shows:</p>
          <div className="field">
            <input aria-label="Authenticator code" inputMode="numeric" maxLength={6} value={firstCode} onChange={(e) => setFirstCode(digits(e.target.value))} autoComplete="one-time-code" />
          </div>
          <button className="btn-primary" onClick={confirmEnable} disabled={busy || firstCode.length !== 6}>Confirm and turn on</button>
        </div>
      )}

      {status.totp_enabled && (
        <div className="auth-form">
          <p className="success-box">Two-factor authentication is on. {status.recovery_codes_remaining} recovery code{status.recovery_codes_remaining === 1 ? "" : "s"} left.</p>
          <div className="field">
            <label htmlFor="mpw">Your password</label>
            <PasswordField id="mpw" value={managePassword} onChange={(e) => setManagePassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label htmlFor="mcode">Authenticator code</label>
            <input id="mcode" inputMode="numeric" maxLength={6} value={manageCode} onChange={(e) => setManageCode(digits(e.target.value))} autoComplete="one-time-code" />
          </div>
          <button className="btn-secondary" onClick={regenerate} disabled={busy || !managePassword || manageCode.length !== 6}>Get new recovery codes</button>{" "}
          <button className="btn-secondary" onClick={disable} disabled={busy || !managePassword || manageCode.length !== 6}>Turn off two-factor</button>
        </div>
      )}
    </AppShell>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PayoutDestination, PayoutPreference } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { formatMoney } from "../lib/money";
import AppShell from "../components/AppShell";
import PasswordField from "../components/PasswordField";

export default function Payouts() {
  const { config } = usePaymentConfig();
  const { status: security } = useSecurityStatus();
  const [otp, setOtp] = useState("");
  const otpField = security?.totp_enabled ? { otp: otp.trim() } : {};
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [pref, setPref] = useState<PayoutPreference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // add-account form
  const [kind, setKind] = useState<"mobile_money" | "bank">("mobile_money");
  const [network, setNetwork] = useState("mtn");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [addPassword, setAddPassword] = useState("");

  // auto-payout form
  const [chosen, setChosen] = useState("");
  const [prefPassword, setPrefPassword] = useState("");

  const load = () => {
    easex.payments.destinations.list().then((d) => {
      setDestinations(d);
      setChosen((c) => c || d[0]?.id || "");
    }).catch(() => setError("Couldn't load your payout accounts."));
    easex.payments.payoutPreference.get().then(setPref).catch(() => {});
  };
  useEffect(load, []);

  const netLabel = (d: PayoutDestination) =>
    d.kind === "bank" ? d.bank_name : (config?.mobile_money_networks.find((n) => n.value === d.network)?.label ?? d.network);

  const run = async (fn: () => Promise<unknown>, okMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(okMessage);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addAccount = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await easex.payments.destinations.create({
        kind,
        ...(kind === "bank" ? { bank_name: bankName.trim(), bank_branch: bankBranch.trim() } : { network }),
        account_number: number.trim(),
        account_name: name.trim(),
        password: addPassword,
        ...otpField,
      });
      setNumber(""); setName(""); setBankName(""); setBankBranch(""); setAddPassword("");
    }, "Payout account saved.");
  };

  const setAuto = (enabled: boolean) =>
    run(async () => {
      await easex.payments.payoutPreference.update({ auto_payout_enabled: enabled, destination_id: enabled ? chosen : null, password: prefPassword, ...otpField });
      setPrefPassword("");
    }, enabled ? "Automatic payouts are on." : "Automatic payouts are off.");

  const operatorOn = config?.giftcard_auto_payment_enabled && Number(config.giftcard_auto_payout_max_ghs) > 0;

  return (
    <AppShell>
      <Link to="/wallet" style={{ fontSize: 14, color: "var(--ink-soft)" }}>← Back to wallet</Link>
      <h1 style={{ fontSize: 22, margin: "16px 0 20px" }}>Payout accounts</h1>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-box">{notice}</p>}

      <div className="passbook">
        {destinations.length === 0 ? (
          <div className="empty-row">No payout accounts saved yet.</div>
        ) : (
          destinations.map((d) => (
            <div className="passbook-row" key={d.id}>
              <div className="passbook-row-main">
                <span className="passbook-row-title">{netLabel(d)} · {d.account_number}</span>
                <span className="passbook-row-meta">{d.account_name}</span>
              </div>
              <button className="btn-secondary" disabled={busy} onClick={() => run(() => easex.payments.destinations.remove(d.id), "Payout account removed.")}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <h2 className="section-title">Add a payout account</h2>
      <form className="auth-form" onSubmit={addAccount} noValidate>
        <div className="seg" role="group" aria-label="Account type">
          <button type="button" aria-pressed={kind === "mobile_money"} onClick={() => setKind("mobile_money")}>Mobile money</button>
          <button type="button" aria-pressed={kind === "bank"} onClick={() => setKind("bank")}>Bank account</button>
        </div>
        {kind === "mobile_money" ? (
          <>
            <div className="field">
              <label htmlFor="n">Network</label>
              <select id="n" value={network} onChange={(e) => setNetwork(e.target.value)}>
                {(config?.mobile_money_networks ?? []).map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="num">Number</label>
              <input id="num" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="024 123 4567" />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="bn">Bank name</label>
              <input id="bn" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. GCB Bank" />
            </div>
            <div className="field">
              <label htmlFor="bb">Branch (optional)</label>
              <input id="bb" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="num">Account number</label>
              <input id="num" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="nm">Name on the account</label>
          <input id="nm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="apw">Your password</label>
          <PasswordField id="apw" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {security?.totp_enabled && (
          <div className="field">
            <label htmlFor="otp1">Authenticator code</label>
            <input id="otp1" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
          </div>
        )}
        <button
          className="btn-primary"
          disabled={busy || !number || !name || !addPassword || (kind === "bank" && !bankName)}
        >
          Save account
        </button>
      </form>

      <h2 className="section-title">Automatic gift card payouts</h2>
      {!operatorOn && (
        <p className="warn-box">Automatic payouts aren't switched on yet. Approved gift card earnings will go to your wallet, and you can withdraw them any time.</p>
      )}
      <p className="hint" style={{ margin: "0 0 12px" }}>
        When a gift card sale is approved, we can send the money straight to your mobile money account instead of leaving it in your wallet.
        {config && operatorOn && <> Available for payments up to {formatMoney(config.giftcard_auto_payout_max_ghs, "GHS")}. A newly added account can be used after {config.auto_payout_cooldown_hours} hours.</>}
        {" "}Anything over the limit stays in your wallet.
      </p>

      <div className="auth-form">
        <p style={{ fontSize: 14, margin: "0 0 12px" }}>
          Status: <strong>{pref?.auto_payout_enabled ? "On" : "Off"}</strong>
        </p>
        {destinations.length > 0 && (
          <div className="field">
            <label htmlFor="ad">Send earnings to</label>
            <select id="ad" value={pref?.auto_payout_enabled && pref.destination_id ? pref.destination_id : chosen} onChange={(e) => setChosen(e.target.value)}>
              {destinations.map((d) => <option key={d.id} value={d.id}>{netLabel(d)} · {d.account_number}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="ppw">Your password</label>
          <PasswordField id="ppw" value={prefPassword} onChange={(e) => setPrefPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {security?.totp_enabled && (
          <div className="field">
            <label htmlFor="otp2">Authenticator code</label>
            <input id="otp2" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
          </div>
        )}
        {pref?.auto_payout_enabled ? (
          <button className="btn-secondary" disabled={busy || !prefPassword} onClick={() => setAuto(false)}>Turn off</button>
        ) : (
          <button className="btn-primary" disabled={busy || !prefPassword || !chosen} onClick={() => setAuto(true)}>Turn on</button>
        )}
      </div>
    </AppShell>
  );
}

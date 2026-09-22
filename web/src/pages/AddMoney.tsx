import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { DepositAddress, Transaction } from "@easex/shared";
import { apiErrorMessage, newIdempotencyKey } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { formatMoney } from "../lib/money";
import AppShell from "../components/AppShell";

/** Local "YYYY-MM-DD" / "HH:MM" of a date, for the date and time inputs. */
function localParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** True if `d` is invalid or less than a minute away (the server enforces the same rule). */
function tooSoon(d: Date): boolean {
  return Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000;
}

export default function AddMoney() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { config, refresh } = usePaymentConfig();
  const [tab, setTab] = useState<"momo" | "crypto">("momo");

  // ---- mobile money ----
  const [mode, setMode] = useState<"now" | "later">(params.get("mode") === "later" ? "later" : "now");
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [runDate, setRunDate] = useState(() => localParts(new Date(Date.now() + 24 * 3600 * 1000)).date);
  const [runTime, setRunTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Transaction | null>(null);
  const key = useRef(newIdempotencyKey()); // one key per submission; renewed after success
  const runAt = new Date(`${runDate}T${runTime}`);

  // ---- crypto ----
  const [asset, setAsset] = useState("USDT");
  const [cryptoNetwork, setCryptoNetwork] = useState("");
  const [address, setAddress] = useState<DepositAddress | null>(null);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submitMomo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "later" && tooSoon(runAt)) {
      setError("Choose a time at least a minute from now.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "now") {
        const txn = await easex.payments.load({
          amount: amount.trim(),
          network,
          phone_number: phone.trim(),
          idempotency_key: key.current,
        });
        setResult(txn);
        key.current = newIdempotencyKey();
        refresh();
      } else {
        await easex.payments.scheduledLoads.create({
          amount: amount.trim(),
          network,
          phone_number: phone.trim(),
          idempotency_key: key.current,
          run_at: runAt.toISOString(),
        });
        navigate("/wallet/scheduled");
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const showAddress = async () => {
    setCryptoError(null);
    setAddress(null);
    const net = cryptoNetwork || config?.crypto_networks[asset]?.[0]?.value;
    if (!net) return;
    try {
      setAddress(await easex.payments.depositAddress(asset, net));
    } catch (err) {
      setCryptoError(apiErrorMessage(err));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the address is still selectable on screen */
    }
  };

  const cryptoAssets = config ? Object.keys(config.crypto_networks) : [];
  const networks = config?.crypto_networks[asset] ?? [];

  return (
    <AppShell>
      <Link to="/wallet" style={{ fontSize: 14, color: "var(--ink-soft)" }}>← Back to wallet</Link>
      <h1 style={{ fontSize: 22, margin: "16px 0 20px" }}>Load Wallet</h1>

      <div className="seg" role="group" aria-label="Payment method">
        <button type="button" aria-pressed={tab === "momo"} onClick={() => setTab("momo")}>Mobile money (GHS)</button>
        <button type="button" aria-pressed={tab === "crypto"} onClick={() => setTab("crypto")}>Deposit crypto</button>
      </div>

      {config && !config.loads_enabled && (
        <p className="warn-box">Adding money is paused for a moment. Please try again later.</p>
      )}

      {tab === "momo" && (
        result ? (
          <div>
            {result.status === "settled" ? (
              <p className="success-box">{formatMoney(result.amount, "GHS")} was added to your wallet.</p>
            ) : (
              <>
                <p className="success-box">
                  {result.status === "under_review"
                    ? "Almost there — finish your payment, then we'll confirm it."
                    : "Approve the payment prompt on your phone."}
                </p>
                <div className="summary-list">
                  <div><span>Amount</span><span>{formatMoney(result.amount, "GHS")}</span></div>
                  <div><span>Your reference</span><strong style={{ fontFamily: "var(--font-mono)" }}>{String(result.metadata.reference ?? "")}</strong></div>
                </div>
                {typeof result.metadata.instructions === "string" && result.metadata.instructions && (
                  <p className="notice" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{result.metadata.instructions}</p>
                )}
                <p className="hint">Use your reference so we can match the payment to your account. Your balance updates once we confirm it.</p>
              </>
            )}
            <Link to={`/transactions/${result.id}`} className="btn-secondary" style={{ display: "inline-block", textDecoration: "none" }}>View details</Link>{" "}
            <button className="btn-secondary" onClick={() => { setResult(null); setAmount(""); }}>Add more</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submitMomo} noValidate>
            <div className="seg" role="group" aria-label="When to load">
              <button type="button" aria-pressed={mode === "now"} onClick={() => setMode("now")}>Add now</button>
              <button type="button" aria-pressed={mode === "later"} onClick={() => setMode("later")}>Schedule</button>
            </div>

            <div className="field">
              <label htmlFor="amount">Amount (GHS)</label>
              <input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="100.00" />
            </div>
            {config && <p className="hint">You can add up to {formatMoney(config.loads_remaining_ghs, "GHS")} in the next 24 hours.</p>}
            <div className="field">
              <label htmlFor="network">Network</label>
              <select id="network" value={network} onChange={(e) => setNetwork(e.target.value)}>
                {(config?.mobile_money_networks ?? []).map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="phone">Mobile money number</label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="024 123 4567" />
            </div>

            {mode === "later" && (
              <>
                <div className="field">
                  <label htmlFor="d">Date</label>
                  <input id="d" type="date" value={runDate} min={localParts(new Date()).date} onChange={(e) => setRunDate(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="t">Time</label>
                  <input id="t" type="time" value={runTime} onChange={(e) => setRunTime(e.target.value)} />
                </div>
                <p className="warn-box">
                  We'll start the payment prompt on your phone at that time — approve it then to complete the load.
                </p>
              </>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn-primary" disabled={busy || !amount || !phone || (config ? !config.loads_enabled : false)}>
              {busy ? "Working…" : mode === "now" ? "Continue" : "Schedule load"}
            </button>
          </form>
        )
      )}

      {tab === "crypto" && (
        <div className="auth-form">
          <div className="field">
            <label htmlFor="asset">Asset</label>
            <select id="asset" value={asset} onChange={(e) => { setAsset(e.target.value); setCryptoNetwork(""); setAddress(null); }}>
              {cryptoAssets.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cnet">Network</label>
            <select id="cnet" value={cryptoNetwork || networks[0]?.value || ""} onChange={(e) => { setCryptoNetwork(e.target.value); setAddress(null); }}>
              {networks.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={showAddress}>Show my deposit address</button>
          {cryptoError && <p className="form-error" role="alert">{cryptoError}</p>}
          {address && (
            <div style={{ marginTop: 16 }}>
              <div className="copy-box">{address.address}</div>
              <button className="inline-link-btn" onClick={() => copy(address.address)}>{copied ? "Copied" : "Copy address"}</button>
              {address.memo && <p className="hint" style={{ marginTop: 8 }}>Tag / memo: <strong>{address.memo}</strong> — required.</p>}
              <p className="warn-box" style={{ marginTop: 12 }}>
                Send only <strong>{address.currency}</strong> on the <strong>{networks.find((n) => n.value === address.network)?.label ?? address.network}</strong> network
                to this address. Anything else can be lost permanently.
              </p>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

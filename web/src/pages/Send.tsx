import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Currency, Transaction, Wallet } from "@easex/shared";
import { apiErrorMessage, newIdempotencyKey } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { CURRENCIES, formatMoney } from "../lib/money";
import AppShell from "../components/AppShell";
import PasswordField from "../components/PasswordField";

type Step = "form" | "confirm" | "done";

/** Local "YYYY-MM-DD" / "HH:MM" of a date, for the date and time inputs. */
function localParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** True if `d` is invalid or less than a minute away (the server enforces the same rule). */
function tooSoon(d: Date): boolean {
  return Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000;
}

export default function Send() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { config, refresh } = usePaymentConfig();
  const { status: security } = useSecurityStatus();
  const [wallets, setWallets] = useState<Wallet[]>([]);

  const [mode, setMode] = useState<"now" | "later">(params.get("mode") === "later" ? "later" : "now");
  const [step, setStep] = useState<Step>("form");
  const [recipient, setRecipient] = useState("");
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Lazy initial state: computed once on mount, not on every render.
  const [runDate, setRunDate] = useState(() => localParts(new Date(Date.now() + 24 * 3600 * 1000)).date);
  const [runTime, setRunTime] = useState("09:00");
  const [pin, setPin] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Transaction | null>(null);
  // A fresh key each time the user (re)starts the confirm step; a retry of the
  // SAME confirm keeps it, so a double-tap can never send twice.
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    easex.wallets.list().then(setWallets).catch(() => {});
  }, []);

  const balance = wallets.find((w) => w.currency === currency)?.balance ?? "0";
  const runAt = new Date(`${runDate}T${runTime}`);

  const goConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "later" && tooSoon(runAt)) {
      setError("Choose a time at least a minute from now.");
      return;
    }
    setBusy(true);
    try {
      const found = await easex.payments.lookupRecipient(recipient.trim());
      setDisplayName(found.display_name);
      key.current = newIdempotencyKey();
      setStep("confirm");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const base = { recipient: recipient.trim(), currency, amount: amount.trim(), note: note.trim(), pin, idempotency_key: key.current };
    try {
      if (mode === "now") {
        setSent(await easex.payments.transfer(base));
        setStep("done");
      } else {
        await easex.payments.scheduled.create({ ...base, run_at: runAt.toISOString() });
        navigate("/wallet/scheduled");
      }
      setPin("");
      refresh();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done" && sent) {
    return (
      <AppShell>
        <h1 style={{ fontSize: 22, marginBottom: 16 }}>Sent</h1>
        <p className="success-box">You sent {formatMoney(sent.amount, sent.currency)} to @{String(sent.metadata.counterparty_username ?? "")}.</p>
        <Link to={`/transactions/${sent.id}`} className="btn-secondary" style={{ display: "inline-block", textDecoration: "none" }}>View receipt</Link>{" "}
        <button className="btn-secondary" onClick={() => { setStep("form"); setSent(null); setAmount(""); setNote(""); }}>Send another</button>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link to="/wallet" style={{ fontSize: 14, color: "var(--ink-soft)" }}>← Back to wallet</Link>
      <h1 style={{ fontSize: 22, margin: "16px 0 20px" }}>{mode === "now" ? "Send money" : "Schedule a transfer"}</h1>

      {config && !config.transfers_enabled && <p className="warn-box">Transfers are paused for a moment. Please try again later.</p>}

      {step === "form" ? (
        <form className="auth-form" onSubmit={goConfirm} noValidate>
          <div className="seg" role="group" aria-label="When to send">
            <button type="button" aria-pressed={mode === "now"} onClick={() => setMode("now")}>Send now</button>
            <button type="button" aria-pressed={mode === "later"} onClick={() => setMode("later")}>Schedule</button>
          </div>

          <div className="field">
            <label htmlFor="to">To (username or phone number)</label>
            <input id="to" value={recipient} onChange={(e) => setRecipient(e.target.value)} autoCapitalize="off" autoCorrect="off" />
          </div>
          <div className="field">
            <label htmlFor="cur">Currency</label>
            <select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="amt">Amount</label>
            <input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <p className="hint">
            Available: {formatMoney(balance, currency)}
            {config && <> · Daily allowance left: {formatMoney(config.outgoing_remaining_ghs, "GHS")}</>}
          </p>

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
                We check your balance when the transfer runs, not now. If you don't have enough then, it won't send and we'll tell you.
              </p>
            </>
          )}

          <div className="field">
            <label htmlFor="note">Note (optional)</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} />
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn-primary" disabled={busy || !recipient || !amount || (config ? !config.transfers_enabled : false)}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      ) : (
        <div className="auth-form">
          <div className="summary-list">
            <div><span>To</span><strong>@{displayName}</strong></div>
            <div><span>Amount</span><strong>{formatMoney(amount, currency)}</strong></div>
            {mode === "later" && <div><span>When</span><strong>{runAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</strong></div>}
            {note && <div><span>Note</span><span>{note}</span></div>}
          </div>
          <p className="hint" style={{ marginTop: -8 }}>Check that the name looks right — transfers can't be undone.</p>
          {security && !security.pin_set && (
            <p className="warn-box">You need a transaction PIN before you can send money. <Link to="/security">Set your PIN</Link></p>
          )}
          {security?.cooling_off_until && (
            <p className="warn-box">
              For your security, money can't leave your account until {new Date(security.cooling_off_until).toLocaleString()}.
            </p>
          )}
          <div className="field">
            <label htmlFor="pin">Transaction PIN</label>
            <PasswordField id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="off" />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn-primary" onClick={confirm} disabled={busy || pin.length !== 6}>
            {busy ? "Working…" : mode === "now" ? "Send" : "Schedule transfer"}
          </button>
          <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => { setStep("form"); setError(null); }} disabled={busy}>Back</button>
        </div>
      )}
    </AppShell>
  );
}

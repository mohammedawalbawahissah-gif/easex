import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Currency, PayoutDestination, Transaction, Wallet } from "@easex/shared";
import { apiErrorMessage, newIdempotencyKey } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { CURRENCIES, formatMoney } from "../lib/money";
import AppShell from "../components/AppShell";
import PasswordField from "../components/PasswordField";

/** Local "YYYY-MM-DD" / "HH:MM" of a date, for the date and time inputs. */
function localParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** True if `d` is invalid or less than a minute away (the server enforces the same rule). */
function tooSoon(d: Date): boolean {
  return Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000;
}

export default function Withdraw() {
  const [params] = useSearchParams();
  const { config, refresh } = usePaymentConfig();
  const { status: security } = useSecurityStatus();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [mode, setMode] = useState<"now" | "later">(params.get("mode") === "later" ? "later" : "now");
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [amount, setAmount] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [network, setNetwork] = useState("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [runDate, setRunDate] = useState(() => localParts(new Date(Date.now() + 24 * 3600 * 1000)).date);
  const [runTime, setRunTime] = useState("09:00");
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Transaction | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const key = useRef(newIdempotencyKey());
  const runAt = new Date(`${runDate}T${runTime}`);

  const loadData = () => {
    easex.wallets.list().then(setWallets).catch(() => {});
    easex.payments.destinations.list().then((d) => {
      setDestinations(d);
      setDestinationId((cur) => cur || d[0]?.id || "");
    }).catch(() => {});
  };
  useEffect(loadData, []);

  const isFiat = currency === "GHS";
  const balance = wallets.find((w) => w.currency === currency)?.balance ?? "0";
  const networks = config?.crypto_networks[currency] ?? [];
  const chosenNetwork = network || networks[0]?.value || "";
  const needsMemo = networks.find((n) => n.value === chosenNetwork)?.needs_memo ?? false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "later" && tooSoon(runAt)) {
      setError("Choose a time at least a minute from now.");
      return;
    }
    setBusy(true);
    try {
      const base = {
        currency,
        amount: amount.trim(),
        pin,
        ...(security?.totp_enabled ? { otp: otp.trim() } : {}),
        idempotency_key: key.current,
        ...(isFiat
          ? { destination_id: destinationId }
          : { address: address.trim(), network: chosenNetwork, memo: memo.trim() }),
      };
      if (mode === "now") {
        const txn = await easex.payments.withdraw(base);
        setResult(txn);
      } else {
        await easex.payments.scheduledWithdrawals.create({ ...base, run_at: runAt.toISOString() });
        setScheduled(true);
      }
      key.current = newIdempotencyKey();
      setPin("");
      setOtp("");
      refresh();
      loadData();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (scheduled) {
    return (
      <AppShell>
        <h1 style={{ fontSize: 22, marginBottom: 16 }}>Withdrawal scheduled</h1>
        <p className="success-box">
          {formatMoney(amount, currency)} will be withdrawn on {runAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
        </p>
        <p className="hint">We check your balance when it runs, not now. If you don't have enough then, it won't send and we'll tell you.</p>
        <Link to="/wallet/scheduled" className="btn-secondary" style={{ display: "inline-block", textDecoration: "none" }}>View scheduled</Link>{" "}
        <button className="btn-secondary" onClick={() => { setScheduled(false); setAmount(""); }}>Schedule another</button>
      </AppShell>
    );
  }

  if (result) {
    return (
      <AppShell>
        <h1 style={{ fontSize: 22, marginBottom: 16 }}>Withdrawal requested</h1>
        <p className="success-box">
          {result.status === "settled"
            ? `${formatMoney(result.amount, result.currency)} has been sent.`
            : result.status === "verified"
              ? `${formatMoney(result.amount, result.currency)} is on its way.`
              : `${formatMoney(result.amount, result.currency)} is on hold while we review your request. If we can't send it, it goes straight back to your wallet.`}
        </p>
        <Link to={`/transactions/${result.id}`} className="btn-secondary" style={{ display: "inline-block", textDecoration: "none" }}>View details</Link>{" "}
        <button className="btn-secondary" onClick={() => { setResult(null); setAmount(""); }}>Make another</button>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link to="/wallet" style={{ fontSize: 14, color: "var(--ink-soft)" }}>← Back to wallet</Link>
      <h1 style={{ fontSize: 22, margin: "16px 0 20px" }}>{mode === "now" ? "Make Withdrawal" : "Schedule a withdrawal"}</h1>

      {config && !config.withdrawals_enabled && <p className="warn-box">Withdrawals are paused for a moment. Please try again later.</p>}

      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="seg" role="group" aria-label="When to withdraw">
          <button type="button" aria-pressed={mode === "now"} onClick={() => setMode("now")}>Withdraw now</button>
          <button type="button" aria-pressed={mode === "later"} onClick={() => setMode("later")}>Schedule</button>
        </div>

        <div className="field">
          <label htmlFor="cur">Currency</label>
          <select id="cur" value={currency} onChange={(e) => { setCurrency(e.target.value as Currency); setNetwork(""); setError(null); }}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="amt">Amount</label>
          <input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={isFiat ? "100.00" : "0.0"} />
        </div>
        <p className="hint">
          Available: {formatMoney(balance, currency)} ·{" "}
          <button type="button" className="inline-link-btn" onClick={() => setAmount(String(balance))}>Use all</button>
          {config && <> · Daily allowance left: {formatMoney(config.outgoing_remaining_ghs, "GHS")}</>}
        </p>

        {isFiat ? (
          <div className="field">
            <label htmlFor="dest">Send to</label>
            {destinations.length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>You haven't saved a payout account yet. <Link to="/payouts">Add one</Link></p>
            ) : (
              <>
                <select id="dest" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.kind === "bank" ? d.bank_name : (config?.mobile_money_networks.find((n) => n.value === d.network)?.label ?? d.network)} · {d.account_number} · {d.account_name}
                    </option>
                  ))}
                </select>
                <Link to="/payouts" style={{ fontSize: 13 }}>Manage payout accounts</Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="net">Network</label>
              <select id="net" value={chosenNetwork} onChange={(e) => setNetwork(e.target.value)}>
                {networks.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="addr">Destination address</label>
              <input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </div>
            {needsMemo && (
              <div className="field">
                <label htmlFor="memo">Destination tag (if the receiver gave you one)</label>
                <input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} inputMode="numeric" />
              </div>
            )}
            <p className="warn-box">
              Double-check the address and network. Crypto sent to the wrong address or network can't be recovered.
            </p>
          </>
        )}

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
              We check your balance when the withdrawal runs, not now. If you don't have enough then, it won't send and we'll tell you.
            </p>
          </>
        )}

        {security && !security.pin_set && (
          <p className="warn-box">You need a transaction PIN before you can withdraw. <Link to="/security">Set your PIN</Link></p>
        )}
        {security?.cooling_off_until && (
          <p className="warn-box">
            For your security, money can't leave your account until {new Date(security.cooling_off_until).toLocaleString()} (after a recent
            password reset or PIN / 2FA change).
          </p>
        )}
        <div className="field">
          <label htmlFor="pin">Transaction PIN</label>
          <PasswordField id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="off" />
        </div>
        {security?.totp_enabled && (
          <div className="field">
            <label htmlFor="otp">Authenticator code</label>
            <input id="otp" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn-primary" disabled={busy || !amount || pin.length !== 6 || (security?.totp_enabled ? otp.length !== 6 : false) || (config ? !config.withdrawals_enabled : false)}>
          {busy ? "Working…" : mode === "now" ? "Withdraw" : "Schedule withdrawal"}
        </button>
      </form>
    </AppShell>
  );
}

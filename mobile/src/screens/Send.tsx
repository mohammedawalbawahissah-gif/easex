import { useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Currency, Transaction } from "@easex/shared";
import { apiErrorMessage, newIdempotencyKey } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { CURRENCIES, formatMoney } from "../lib/money";
import { Screen, Title, Field, Hint, PrimaryButton, SecondaryButton, Message, Segmented, Choice, SummaryList } from "../components/ui";
import { useEffect } from "react";
import type { Wallet } from "@easex/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** True if `d` is invalid or less than a minute away (the server enforces the same rule). */
function tooSoon(d: Date): boolean {
  return Number.isNaN(d.getTime()) || d.getTime() < Date.now() + 60_000;
}

/** "YYYY-MM-DD" + "HH:MM" typed by the user -> a Date, or Invalid Date. */
function parseLocal(date: string, time: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || !t) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
}

export default function SendScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { config, refresh } = usePaymentConfig();
  const { status: security } = useSecurityStatus();
  const [wallets, setWallets] = useState<Wallet[]>([]);

  const [mode, setMode] = useState(params.mode === "later" ? "later" : "now");
  const [step, setStep] = useState<"form" | "confirm" | "done">("form");
  const [recipient, setRecipient] = useState("");
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [runDate, setRunDate] = useState(() => dateStr(new Date(Date.now() + 24 * 3600 * 1000)));
  const [runTime, setRunTime] = useState("09:00");
  const [pin, setPin] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Transaction | null>(null);
  // Fresh key each time the confirm step is (re)entered; a retry of the SAME
  // confirm keeps it, so a double-tap can never send twice.
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    easex.wallets.list().then(setWallets).catch(() => {});
  }, []);

  const balance = wallets.find((w) => w.currency === currency)?.balance ?? "0";
  const runAt = parseLocal(runDate, runTime);

  const preset = (hoursFromNow: number, atHour?: number) => {
    const d = new Date(Date.now() + hoursFromNow * 3600 * 1000);
    if (atHour !== undefined) d.setHours(atHour, 0, 0, 0);
    setRunDate(dateStr(d));
    setRunTime(timeStr(d));
  };

  const goConfirm = async () => {
    setError(null);
    if (mode === "later" && tooSoon(runAt)) {
      setError("Enter a valid date and time (YYYY-MM-DD and HH:MM), at least a minute from now.");
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
        router.replace("/(tabs)/scheduled");
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
      <Screen>
        <Title>Sent</Title>
        <Message kind="success">You sent {formatMoney(sent.amount, sent.currency)} to @{String(sent.metadata.counterparty_username ?? "")}.</Message>
        <SecondaryButton title="View receipt" onPress={() => router.push(`/transaction/${sent.id}`)} />
        <SecondaryButton title="Send another" onPress={() => { setStep("form"); setSent(null); setAmount(""); setNote(""); }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{mode === "now" ? "Send money" : "Schedule a transfer"}</Title>
      {config && !config.transfers_enabled && <Message kind="warn">Transfers are paused for a moment. Please try again later.</Message>}

      {step === "form" ? (
        <View>
          <Segmented options={[{ value: "now", label: "Send now" }, { value: "later", label: "Schedule" }]} value={mode} onChange={setMode} />
          <Field label="To (username or phone number)" value={recipient} onChangeText={setRecipient} />
          <Choice label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={(v) => setCurrency(v as Currency)} />
          <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Hint>
            Available: {formatMoney(balance, currency)}
            {config ? ` · Daily allowance left: ${formatMoney(config.outgoing_remaining_ghs, "GHS")}` : ""}
          </Hint>

          {mode === "later" && (
            <View>
              <Choice
                label="When"
                options={[{ value: "1h", label: "In 1 hour" }, { value: "tom", label: "Tomorrow 9:00" }, { value: "wk", label: "Next week" }]}
                value=""
                onChange={(v) => (v === "1h" ? preset(1) : v === "tom" ? preset(24, 9) : preset(24 * 7, 9))}
              />
              <Field label="Date (YYYY-MM-DD)" value={runDate} onChangeText={setRunDate} keyboardType="numbers-and-punctuation" />
              <Field label="Time (24-hour HH:MM)" value={runTime} onChangeText={setRunTime} keyboardType="numbers-and-punctuation" />
              <Message kind="warn">We check your balance when the transfer runs, not now. If you don't have enough then, it won't send and we'll tell you.</Message>
            </View>
          )}

          <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={140} autoCapitalize="sentences" autoCorrect />
          {error && <Message kind="error">{error}</Message>}
          <PrimaryButton title="Continue" onPress={goConfirm} busy={busy} disabled={!recipient || !amount || (config ? !config.transfers_enabled : false)} />
        </View>
      ) : (
        <View>
          <SummaryList
            rows={[
              { label: "To", value: `@${displayName}` },
              { label: "Amount", value: formatMoney(amount, currency) },
              ...(mode === "later" ? [{ label: "When", value: runAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }] : []),
              ...(note ? [{ label: "Note", value: note }] : []),
            ]}
          />
          <Hint>Check that the name looks right — transfers can't be undone.</Hint>
          {security && !security.pin_set && (
            <View>
              <Message kind="warn">You need a transaction PIN before you can send money.</Message>
              <SecondaryButton title="Set your PIN" onPress={() => router.push("/(tabs)/security")} />
            </View>
          )}
          {!!security?.cooling_off_until && (
            <Message kind="warn">For your security, money can't leave your account until {new Date(security.cooling_off_until).toLocaleString()}.</Message>
          )}
          <Field label="Transaction PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} secureToggle keyboardType="number-pad" maxLength={6} />
          {error && <Message kind="error">{error}</Message>}
          <PrimaryButton title={mode === "now" ? "Send" : "Schedule transfer"} onPress={confirm} busy={busy} disabled={pin.length !== 6} />
          <SecondaryButton title="Back" onPress={() => { setStep("form"); setError(null); }} disabled={busy} />
        </View>
      )}
    </Screen>
  );
}

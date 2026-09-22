import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { Currency, PayoutDestination, Transaction, Wallet } from "@easex/shared";
import { apiErrorMessage, newIdempotencyKey } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { CURRENCIES, formatMoney } from "../lib/money";
import { colors, fonts } from "../theme";
import { Screen, Title, Field, Hint, PrimaryButton, SecondaryButton, Message, Segmented, Choice } from "../components/ui";

const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

export default function WithdrawScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { config, refresh } = usePaymentConfig();
  const { status: security, refresh: refreshSecurity } = useSecurityStatus();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [mode, setMode] = useState(params.mode === "later" ? "later" : "now");
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [amount, setAmount] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [network, setNetwork] = useState("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [runDate, setRunDate] = useState(() => dateStr(new Date(Date.now() + 24 * 3600 * 1000)));
  const [runTime, setRunTime] = useState("09:00");
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Transaction | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const key = useRef(newIdempotencyKey());
  const runAt = parseLocal(runDate, runTime);

  const loadData = useCallback(() => {
    easex.wallets.list().then(setWallets).catch(() => {});
    easex.payments.destinations.list().then((d) => {
      setDestinations(d);
      setDestinationId((cur) => (d.some((x) => x.id === cur) ? cur : d[0]?.id ?? ""));
    }).catch(() => {});
  }, []);
  useEffect(loadData, [loadData]);
  // Coming back from "Payout accounts" should show the account you just added.
  useFocusEffect(loadData);
  useFocusEffect(useCallback(() => { refreshSecurity(); }, [refreshSecurity]));

  const isFiat = currency === "GHS";
  const balance = wallets.find((w) => w.currency === currency)?.balance ?? "0";
  const networks = config?.crypto_networks[currency] ?? [];
  const chosenNetwork = network || networks[0]?.value || "";
  const needsMemo = networks.find((n) => n.value === chosenNetwork)?.needs_memo ?? false;

  const submit = async () => {
    setError(null);
    if (mode === "later" && tooSoon(runAt)) {
      setError("Enter a valid date and time (YYYY-MM-DD and HH:MM), at least a minute from now.");
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
        ...(isFiat ? { destination_id: destinationId } : { address: address.trim(), network: chosenNetwork, memo: memo.trim() }),
      };
      if (mode === "now") {
        setResult(await easex.payments.withdraw(base));
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
      <Screen>
        <Title>Withdrawal scheduled</Title>
        <Message kind="success">
          {formatMoney(amount, currency)} will be withdrawn on {runAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
        </Message>
        <Hint>We check your balance when it runs, not now. If you don't have enough then, it won't send and we'll tell you.</Hint>
        <SecondaryButton title="View scheduled" onPress={() => router.push("/(tabs)/scheduled")} />
        <SecondaryButton title="Schedule another" onPress={() => { setScheduled(false); setAmount(""); }} />
      </Screen>
    );
  }

  if (result) {
    return (
      <Screen>
        <Title>Withdrawal requested</Title>
        <Message kind="success">
          {result.status === "settled"
            ? `${formatMoney(result.amount, result.currency)} has been sent.`
            : result.status === "verified"
              ? `${formatMoney(result.amount, result.currency)} is on its way.`
              : `${formatMoney(result.amount, result.currency)} is on hold while we review your request. If we can't send it, it goes straight back to your wallet.`}
        </Message>
        <SecondaryButton title="View details" onPress={() => router.push(`/transaction/${result.id}`)} />
        <SecondaryButton title="Make another" onPress={() => { setResult(null); setAmount(""); }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{mode === "now" ? "Make Withdrawal" : "Schedule a withdrawal"}</Title>
      {config && !config.withdrawals_enabled && <Message kind="warn">Withdrawals are paused for a moment. Please try again later.</Message>}

      <Segmented options={[{ value: "now", label: "Withdraw now" }, { value: "later", label: "Schedule" }]} value={mode} onChange={setMode} />

      <Choice label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} value={currency} onChange={(v) => { setCurrency(v as Currency); setNetwork(""); setError(null); }} />
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={isFiat ? "100.00" : "0.0"} />
      <Hint>
        Available: {formatMoney(balance, currency)}
        {config ? ` · Daily allowance left: ${formatMoney(config.outgoing_remaining_ghs, "GHS")}` : ""}
      </Hint>
      <SecondaryButton title="Use all" onPress={() => setAmount(String(balance))} />

      {isFiat ? (
        destinations.length === 0 ? (
          <View style={{ marginVertical: 16 }}>
            <Hint>You haven't saved a mobile money account yet.</Hint>
            <SecondaryButton title="Add a payout account" onPress={() => router.push("/(tabs)/payouts")} />
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <Choice
              label="Send to"
              options={destinations.map((d) => ({ value: d.id, label: `${d.network.toUpperCase()} · ${d.account_number}` }))}
              value={destinationId}
              onChange={setDestinationId}
            />
            <Text onPress={() => router.push("/(tabs)/payouts")} style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.indigo, marginBottom: 12 }}>Manage payout accounts</Text>
          </View>
        )
      ) : (
        <View style={{ marginTop: 16 }}>
          <Choice label="Network" options={networks.map((n) => ({ value: n.value, label: n.label }))} value={chosenNetwork} onChange={setNetwork} />
          <Field label="Destination address" value={address} onChangeText={setAddress} spellCheck={false} />
          {needsMemo && <Field label="Destination tag (if the receiver gave you one)" value={memo} onChangeText={setMemo} keyboardType="number-pad" />}
          <Message kind="warn">Double-check the address and network. Crypto sent to the wrong address or network can't be recovered.</Message>
        </View>
      )}

      {mode === "later" && (
        <View>
          <Field label="Date (YYYY-MM-DD)" value={runDate} onChangeText={setRunDate} keyboardType="numbers-and-punctuation" />
          <Field label="Time (24-hour HH:MM)" value={runTime} onChangeText={setRunTime} keyboardType="numbers-and-punctuation" />
          <Message kind="warn">We check your balance when the withdrawal runs, not now. If you don't have enough then, it won't send and we'll tell you.</Message>
        </View>
      )}

      {security && !security.pin_set && (
        <View>
          <Message kind="warn">You need a transaction PIN before you can withdraw.</Message>
          <SecondaryButton title="Set your PIN" onPress={() => router.push("/(tabs)/security")} />
        </View>
      )}
      {!!security?.cooling_off_until && (
        <Message kind="warn">
          For your security, money can't leave your account until {new Date(security.cooling_off_until).toLocaleString()} (after a recent password reset or PIN / 2FA change).
        </Message>
      )}
      <Field label="Transaction PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} secureToggle keyboardType="number-pad" maxLength={6} />
      {security?.totp_enabled && (
        <Field label="Authenticator code" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
      )}
      {error && <Message kind="error">{error}</Message>}
      <PrimaryButton
        title={mode === "now" ? "Withdraw" : "Schedule withdrawal"}
        onPress={submit}
        busy={busy}
        disabled={!amount || pin.length !== 6 || (security?.totp_enabled ? otp.length !== 6 : false) || (config ? !config.withdrawals_enabled : false)}
      />
    </Screen>
  );
}

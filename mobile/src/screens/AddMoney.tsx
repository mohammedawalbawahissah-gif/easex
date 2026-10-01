import { useRef, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { DepositAddress, Transaction } from "@easex/shared";
import { apiErrorMessage, newIdempotencyKey } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { formatMoney } from "../lib/money";
import { colors, fonts } from "../theme";
import { Screen, Title, Field, Hint, PrimaryButton, SecondaryButton, Message, Segmented, Choice, SummaryList } from "../components/ui";

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

export default function AddMoneyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { config, refresh } = usePaymentConfig();
  const [tab, setTab] = useState("momo");

  const [mode, setMode] = useState(params.mode === "later" ? "later" : "now");
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [runDate, setRunDate] = useState(() => dateStr(new Date(Date.now() + 24 * 3600 * 1000)));
  const [runTime, setRunTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Transaction | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const key = useRef(newIdempotencyKey()); // one key per submission; renewed after success
  const runAt = parseLocal(runDate, runTime);

  const [asset, setAsset] = useState("USDT");
  const [cryptoNetwork, setCryptoNetwork] = useState("");
  const [address, setAddress] = useState<DepositAddress | null>(null);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  const submitMomo = async () => {
    setError(null);
    if (mode === "later" && tooSoon(runAt)) {
      setError("Enter a valid date and time (YYYY-MM-DD and HH:MM), at least a minute from now.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "now") {
        const txn = await easex.payments.load({
          amount: amount.trim(),
          network,
          ...(network !== "bank" ? { phone_number: phone.trim() } : {}),
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
        setScheduled(true);
        key.current = newIdempotencyKey();
        refresh();
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: string) => {
    setMode(m);
    if (m === "later" && network === "bank") setNetwork("mtn"); // scheduled loads are mobile-money only
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

  const assets = config ? Object.keys(config.crypto_networks) : [];
  const networks = config?.crypto_networks[asset] ?? [];
  const chosenNet = cryptoNetwork || networks[0]?.value || "";

  if (scheduled) {
    return (
      <Screen>
        <Title>Load scheduled</Title>
        <Message kind="success">
          {formatMoney(amount, "GHS")} will be requested via {network.toUpperCase()} on{" "}
          {runAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
        </Message>
        <Hint>We'll start the payment prompt on your phone at that time — approve it then to complete the load.</Hint>
        <SecondaryButton title="View scheduled" onPress={() => router.push("/(tabs)/scheduled")} />
        <SecondaryButton title="Schedule another" onPress={() => { setScheduled(false); setAmount(""); }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Load Wallet</Title>
      <Segmented
        options={[{ value: "momo", label: "Mobile money (GHS)" }, { value: "crypto", label: "Deposit crypto" }]}
        value={tab}
        onChange={setTab}
      />

      {config && !config.loads_enabled && <Message kind="warn">Adding money is paused for a moment. Please try again later.</Message>}

      {tab === "momo" &&
        (result ? (
          <View>
            {result.status === "settled" ? (
              <Message kind="success">{formatMoney(result.amount, "GHS")} was added to your wallet.</Message>
            ) : (
              <>
                <Message kind="success">
                  {result.status === "under_review" ? "Almost there — finish your payment, then we'll confirm it." : "Approve the payment prompt on your phone."}
                </Message>
                <SummaryList rows={[{ label: "Amount", value: formatMoney(result.amount, "GHS") }, { label: "Your reference", value: String(result.metadata.reference ?? ""), mono: true }]} />
                {typeof result.metadata.instructions === "string" && !!result.metadata.instructions && <Message kind="warn">{result.metadata.instructions}</Message>}
                <Hint>Use your reference so we can match the payment to your account. Your balance updates once we confirm it.</Hint>
              </>
            )}
            <SecondaryButton title="View details" onPress={() => router.push(`/transaction/${result.id}`)} />
            <SecondaryButton title="Add more" onPress={() => { setResult(null); setAmount(""); }} />
          </View>
        ) : (
          <View>
            <Segmented options={[{ value: "now", label: "Add now" }, { value: "later", label: "Schedule" }]} value={mode} onChange={switchMode} />
            <Field
              label="Amount (GHS)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="100.00"
              hint={config ? `You can add up to ${formatMoney(config.loads_remaining_ghs, "GHS")} in the next 24 hours.` : undefined}
            />
            <Choice
              label="Payment method"
              options={(mode === "now" ? config?.payment_methods : config?.mobile_money_networks)?.map((n) => ({ value: n.value, label: n.label })) ?? []}
              value={network}
              onChange={setNetwork}
            />
            {network === "bank" ? (
              <Hint>We'll show you EaseX's account details and a reference after you continue — your balance updates once we match your transfer.</Hint>
            ) : (
              <Field label="Mobile money number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="024 123 4567" />
            )}

            {mode === "later" && (
              <View>
                <Field label="Date (YYYY-MM-DD)" value={runDate} onChangeText={setRunDate} keyboardType="numbers-and-punctuation" />
                <Field label="Time (24-hour HH:MM)" value={runTime} onChangeText={setRunTime} keyboardType="numbers-and-punctuation" />
                <Message kind="warn">We'll start the payment prompt on your phone at that time — approve it then to complete the load.</Message>
              </View>
            )}

            {error && <Message kind="error">{error}</Message>}
            <PrimaryButton
              title={mode === "now" ? "Continue" : "Schedule load"}
              onPress={submitMomo}
              busy={busy}
              disabled={!amount || (network !== "bank" && !phone) || (config ? !config.loads_enabled : false)}
            />
          </View>
        ))}

      {tab === "crypto" && (
        <View>
          <Choice label="Asset" options={assets.map((c) => ({ value: c, label: c }))} value={asset} onChange={(v) => { setAsset(v); setCryptoNetwork(""); setAddress(null); }} />
          <Choice label="Network" options={networks.map((n) => ({ value: n.value, label: n.label }))} value={chosenNet} onChange={(v) => { setCryptoNetwork(v); setAddress(null); }} />
          <PrimaryButton title="Show my deposit address" onPress={showAddress} />
          {cryptoError && <Message kind="error">{cryptoError}</Message>}
          {address && (
            <View style={{ marginTop: 16 }}>
              <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: 6, padding: 12, backgroundColor: colors.paperRaised }}>
                <Text selectable style={{ fontFamily: fonts.monoSemiBold, fontSize: 13, color: colors.ink }}>{address.address}</Text>
              </View>
              <Hint>Press and hold the address to copy it.</Hint>
              {!!address.memo && <Hint>Tag / memo: {address.memo} — required.</Hint>}
              <Message kind="warn">
                Send only {address.currency} on the {networks.find((n) => n.value === address.network)?.label ?? address.network} network to this address. Anything else can be lost permanently.
              </Message>
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

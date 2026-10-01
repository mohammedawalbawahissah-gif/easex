import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { PayoutDestination, PayoutPreference } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { usePaymentConfig } from "../lib/usePaymentConfig";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { formatMoney } from "../lib/money";
import { colors, fonts } from "../theme";
import { Screen, Title, SectionTitle, Field, Hint, PrimaryButton, SecondaryButton, Message, Choice, Segmented } from "../components/ui";

export default function PayoutsScreen() {
  const { config } = usePaymentConfig();
  const { status: security } = useSecurityStatus();
  const [otp, setOtp] = useState("");
  const otpField = security?.totp_enabled ? { otp: otp.trim() } : {};
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [pref, setPref] = useState<PayoutPreference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<"mobile_money" | "bank">("mobile_money");
  const [network, setNetwork] = useState("mtn");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [chosen, setChosen] = useState("");
  const [prefPassword, setPrefPassword] = useState("");

  const load = useCallback(() => {
    easex.payments.destinations.list().then((d) => {
      setDestinations(d);
      setChosen((c) => (d.some((x) => x.id === c) ? c : d[0]?.id ?? ""));
    }).catch(() => setError("Couldn't load your payout accounts."));
    easex.payments.payoutPreference.get().then(setPref).catch(() => {});
  }, []);
  useEffect(load, [load]);

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

  const addAccount = () =>
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

  const setAuto = (enabled: boolean) =>
    run(async () => {
      await easex.payments.payoutPreference.update({ auto_payout_enabled: enabled, destination_id: enabled ? chosen : null, password: prefPassword, ...otpField });
      setPrefPassword("");
    }, enabled ? "Automatic payouts are on." : "Automatic payouts are off.");

  const operatorOn = !!config?.giftcard_auto_payment_enabled && Number(config.giftcard_auto_payout_max_ghs) > 0;
  const activeDestination = pref?.auto_payout_enabled && pref.destination_id ? pref.destination_id : chosen;

  return (
    <Screen>
      <Title>Payout accounts</Title>
      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="success">{notice}</Message>}

      <View style={styles.list}>
        {destinations.length === 0 ? (
          <Text style={styles.empty}>No payout accounts saved yet.</Text>
        ) : (
          destinations.map((d) => (
            <View key={d.id} style={styles.row}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.rowTitle}>{netLabel(d)} · {d.account_number}</Text>
                <Text style={styles.rowMeta}>{d.account_name}</Text>
              </View>
              <TouchableOpacity style={styles.remove} disabled={busy} onPress={() => run(() => easex.payments.destinations.remove(d.id), "Payout account removed.")}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <SectionTitle>Add a payout account</SectionTitle>
      <Segmented
        options={[{ value: "mobile_money", label: "Mobile money" }, { value: "bank", label: "Bank account" }]}
        value={kind}
        onChange={(v) => setKind(v as "mobile_money" | "bank")}
      />
      {kind === "mobile_money" ? (
        <>
          <Choice label="Network" options={(config?.mobile_money_networks ?? []).map((n) => ({ value: n.value, label: n.label }))} value={network} onChange={setNetwork} />
          <Field label="Number" value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="024 123 4567" />
        </>
      ) : (
        <>
          <Field label="Bank name" value={bankName} onChangeText={setBankName} placeholder="e.g. GCB Bank" autoCapitalize="words" />
          <Field label="Branch (optional)" value={bankBranch} onChangeText={setBankBranch} autoCapitalize="words" />
          <Field label="Account number" value={number} onChangeText={setNumber} keyboardType="number-pad" />
        </>
      )}
      <Field label="Name on the account" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect />
      <Field label="Your password" value={addPassword} onChangeText={setAddPassword} secureToggle autoComplete="current-password" />
      {security?.totp_enabled && (
        <Field label="Authenticator code" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
      )}
      <PrimaryButton title="Save account" onPress={addAccount} busy={busy} disabled={!number || !name || !addPassword || (kind === "bank" && !bankName)} />

      <SectionTitle>Automatic gift card payouts</SectionTitle>
      {!operatorOn && <Message kind="warn">Automatic payouts aren't switched on yet. Approved gift card earnings will go to your wallet, and you can withdraw them any time.</Message>}
      <Hint>
        When a gift card sale is approved, we can send the money straight to your mobile money account instead of leaving it in your wallet.
        {config && operatorOn ? ` Available for payments up to ${formatMoney(config.giftcard_auto_payout_max_ghs, "GHS")}. A newly added account can be used after ${config.auto_payout_cooldown_hours} hours.` : ""}
        {" "}Anything over the limit stays in your wallet.
      </Hint>
      <Text style={styles.status}>Status: {pref?.auto_payout_enabled ? "On" : "Off"}</Text>
      {destinations.length > 0 && (
        <Choice label="Send earnings to" options={destinations.map((d) => ({ value: d.id, label: `${netLabel(d)} · ${d.account_number}` }))} value={activeDestination} onChange={setChosen} />
      )}
      <Field label="Your password" value={prefPassword} onChangeText={setPrefPassword} secureToggle autoComplete="current-password" />
      {security?.totp_enabled && (
        <Field label="Authenticator code" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
      )}
      {pref?.auto_payout_enabled ? (
        <SecondaryButton title="Turn off" onPress={() => setAuto(false)} disabled={busy || !prefPassword} />
      ) : (
        <PrimaryButton title="Turn on" onPress={() => setAuto(true)} busy={busy} disabled={!prefPassword || !chosen} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  rowMeta: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  empty: { fontFamily: fonts.bodyRegular, color: colors.inkSoft, fontSize: 14, paddingVertical: 20 },
  remove: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
  removeText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  status: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink, marginBottom: 12 },
});

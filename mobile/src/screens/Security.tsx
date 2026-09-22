import { useCallback, useState } from "react";
import { View, Text, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import type { TotpSetup } from "@easex/shared";
import { apiErrorMessage } from "@easex/shared";
import { easex } from "../lib/easexClient";
import { useSecurityStatus } from "../lib/useSecurityStatus";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../theme";
import { Screen, Title, SectionTitle, Field, Hint, PrimaryButton, SecondaryButton, Message } from "../components/ui";

const digits = (v: string) => v.replace(/\D/g, "");

export default function SecurityScreen() {
  const { status, refresh } = useSecurityStatus();
  const { adoptTokens } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pinPassword, setPinPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinOtp, setPinOtp] = useState("");

  const [enablePassword, setEnablePassword] = useState("");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [firstCode, setFirstCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [managePassword, setManagePassword] = useState("");
  const [manageCode, setManageCode] = useState("");

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

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

  const savePin = () => {
    if (pin !== confirmPin) {
      setError("The PINs don't match.");
      return;
    }
    return run(async () => {
      await easex.security.setPin({ pin, password: pinPassword, ...(status?.totp_enabled ? { otp: pinOtp.trim() } : {}) });
      setPin(""); setConfirmPin(""); setPinPassword(""); setPinOtp("");
      setNotice(status?.pin_set ? "PIN changed. For your security, money can't leave your account for the next 24 hours." : "PIN set. You can now send and withdraw.");
    });
  };

  const startSetup = () =>
    run(async () => {
      setSetup(await easex.security.twoFactor.setup(enablePassword));
      setEnablePassword("");
    });

  const confirmEnable = () =>
    run(async () => {
      const result = await easex.security.twoFactor.enable(firstCode.trim());
      await adoptTokens(result.tokens); // every other session was signed out; this device stays in
      setRecoveryCodes(result.recovery_codes);
      setSetup(null);
      setFirstCode("");
    });

  const disable = () =>
    run(async () => {
      const result = await easex.security.twoFactor.disable(managePassword, manageCode.trim());
      await adoptTokens(result.tokens);
      setManagePassword(""); setManageCode("");
      setNotice("Two-factor authentication is off. For your security, money can't leave your account for the next 24 hours.");
    });

  const regenerate = () =>
    run(async () => {
      const result = await easex.security.twoFactor.regenerateRecoveryCodes(managePassword, manageCode.trim());
      setRecoveryCodes(result.recovery_codes);
      setManagePassword(""); setManageCode("");
    });

  if (!status) return <Screen><Hint>Loading…</Hint></Screen>;

  return (
    <Screen>
      <Title>Security</Title>
      {!!error && <Message kind="error">{error}</Message>}
      {!!notice && <Message kind="success">{notice}</Message>}
      {!!status.cooling_off_until && (
        <Message kind="warn">As a precaution, money can't leave your account until {new Date(status.cooling_off_until).toLocaleString()}.</Message>
      )}
      {status.is_staff && !status.totp_enabled && (
        <Message kind="warn">Staff accounts must turn on two-factor authentication before using the admin tools.</Message>
      )}

      <SectionTitle>Transaction PIN</SectionTitle>
      <Hint>A 6-digit PIN confirms every send and withdrawal. {status.pin_set ? "Changing it pauses withdrawals for 24 hours." : "Set one to start moving money."}</Hint>
      <Field label="Your password" value={pinPassword} onChangeText={setPinPassword} secureToggle autoComplete="current-password" />
      <Field label={`${status.pin_set ? "New PIN" : "PIN"} (6 digits)`} value={pin} onChangeText={(v) => setPin(digits(v))} secureToggle keyboardType="number-pad" maxLength={6} />
      <Field label="Confirm PIN" value={confirmPin} onChangeText={(v) => setConfirmPin(digits(v))} secureToggle keyboardType="number-pad" maxLength={6} />
      {status.totp_enabled && (
        <Field label="Authenticator code" value={pinOtp} onChangeText={(v) => setPinOtp(digits(v))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
      )}
      <PrimaryButton title={status.pin_set ? "Change PIN" : "Set PIN"} onPress={savePin} busy={busy}
        disabled={!pinPassword || pin.length !== 6 || confirmPin.length !== 6 || (status.totp_enabled && pinOtp.length !== 6)} />

      <SectionTitle>Two-factor authentication</SectionTitle>

      {recoveryCodes && (
        <View>
          <Message kind="warn">Save these recovery codes now. Each works once if you lose your phone. They will not be shown again.</Message>
          <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: 6, padding: 12, backgroundColor: colors.paperRaised }}>
            <Text selectable style={{ fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.ink, lineHeight: 22 }}>{recoveryCodes.join("\n")}</Text>
          </View>
          <SecondaryButton title="I've saved them" onPress={() => setRecoveryCodes(null)} />
        </View>
      )}

      {!status.totp_enabled && !setup && (
        <View>
          <Hint>Adds a code from an authenticator app (Google Authenticator, Authy, 1Password…) to sign-in, withdrawals and account changes.</Hint>
          <Field label="Your password" value={enablePassword} onChangeText={setEnablePassword} secureToggle autoComplete="current-password" />
          <PrimaryButton title="Turn on" onPress={startSetup} busy={busy} disabled={!enablePassword} />
        </View>
      )}

      {setup && (
        <View>
          <Hint>1. Open your authenticator app with the key filled in:</Hint>
          <SecondaryButton title="Open authenticator app" onPress={() => Linking.openURL(setup.otpauth_uri).catch(() => setError("Couldn't open an authenticator app. Enter the key below by hand."))} />
          <Hint>Or enter this setup key by hand:</Hint>
          <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: 6, padding: 12, backgroundColor: colors.paperRaised, marginBottom: 12 }}>
            <Text selectable style={{ fontFamily: fonts.monoSemiBold, fontSize: 14, color: colors.ink }}>{setup.secret}</Text>
          </View>
          <Field label="2. Enter the 6-digit code it shows" value={firstCode} onChangeText={(v) => setFirstCode(digits(v))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
          <PrimaryButton title="Confirm and turn on" onPress={confirmEnable} busy={busy} disabled={firstCode.length !== 6} />
        </View>
      )}

      {status.totp_enabled && (
        <View>
          <Message kind="success">Two-factor authentication is on. {status.recovery_codes_remaining} recovery code{status.recovery_codes_remaining === 1 ? "" : "s"} left.</Message>
          <Field label="Your password" value={managePassword} onChangeText={setManagePassword} secureToggle autoComplete="current-password" />
          <Field label="Authenticator code" value={manageCode} onChangeText={(v) => setManageCode(digits(v))} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
          <SecondaryButton title="Get new recovery codes" onPress={regenerate} disabled={busy || !managePassword || manageCode.length !== 6} />
          <SecondaryButton title="Turn off two-factor" onPress={disable} disabled={busy || !managePassword || manageCode.length !== 6} />
        </View>
      )}
    </Screen>
  );
}

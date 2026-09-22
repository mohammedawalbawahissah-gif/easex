import { useState } from "react";
import { View, TextInput, TouchableOpacity, Text, StyleSheet, type TextInputProps } from "react-native";
import { colors } from "../theme";

/**
 * Drop-in replacement for a password/PIN TextInput — same props, just
 * wrapped with a show/hide toggle. Used for every password and PIN
 * field across the app (login, register, security PIN, transaction
 * PIN) so it behaves identically everywhere rather than being
 * reimplemented per screen. Ignores any `secureTextEntry` passed in —
 * that's this component's whole job, driven by its own toggle state.
 */
export default function PasswordField(props: TextInputProps) {
  const [visible, setVisible] = useState(false);
  const { style, secureTextEntry: _ignored, ...rest } = props;
  return (
    <View style={styles.wrap}>
      <TextInput {...rest} secureTextEntry={!visible} style={[styles.input, style]} />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        accessibilityLabel={visible ? "Hide" : "Show"}
        style={styles.toggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.toggleText}>{visible ? "Hide" : "Show"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", justifyContent: "center" },
  input: { paddingRight: 52 },
  toggle: { position: "absolute", right: 10 },
  toggleText: { fontSize: 12.5, color: colors.gold, fontWeight: "600" },
});

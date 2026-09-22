import type { ReactNode } from "react";
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal, FlatList, Pressable } from "react-native";
import type { TextInputProps } from "react-native";
import { colors, fonts } from "../theme";

/** Small form kit for the money screens — same palette/type as the rest of the app. */

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/**
 * `secureToggle`: opt a password/PIN field into a show/hide button. When
 * set, this owns visibility internally — any `secureTextEntry` passed in
 * is just the initial-hidden intent, not read directly, so the field
 * can't end up in a state where the toggle and the actual masking
 * disagree. Every other Field usage (non-password) is unaffected —
 * this only changes rendering when the caller opts in.
 */
export function Field({
  label,
  hint,
  secureToggle,
  ...input
}: { label: string; hint?: string; secureToggle?: boolean } & TextInputProps) {
  const [visible, setVisible] = useState(false);
  const { secureTextEntry: _ignored, style, ...rest } = input;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {secureToggle ? (
        <View style={{ justifyContent: "center" }}>
          <TextInput
            style={[styles.input, { paddingRight: 52 }, style]}
            placeholderTextColor={colors.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!visible}
            {...rest}
          />
          <TouchableOpacity
            onPress={() => setVisible((v) => !v)}
            accessibilityLabel={visible ? "Hide" : "Show"}
            style={{ position: "absolute", right: 12 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontSize: 12.5, color: colors.gold, fontWeight: "600" }}>{visible ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          {...input}
        />
      )}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={[styles.hint, { marginBottom: 14 }]}>{children}</Text>;
}

export function PrimaryButton({ title, onPress, disabled, busy }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const off = disabled || busy;
  return (
    <TouchableOpacity style={[styles.primary, off && { opacity: 0.55 }]} onPress={onPress} disabled={off} accessibilityRole="button">
      {busy ? <ActivityIndicator color="#17130A" /> : <Text style={styles.primaryText}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function SecondaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.secondary, disabled && { opacity: 0.55 }]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <Text style={styles.secondaryText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Message({ kind, children }: { kind: "error" | "warn" | "success"; children: ReactNode }) {
  const bg = kind === "error" ? colors.dangerBg : kind === "success" ? colors.successBg : colors.warningBg;
  const fg = kind === "error" ? colors.danger : kind === "success" ? colors.success : colors.ink;
  return (
    <View style={[styles.message, { backgroundColor: bg }]} accessibilityRole={kind === "error" ? "alert" : undefined}>
      <Text style={[styles.messageText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.seg}>
      {options.map((o) => (
        <TouchableOpacity key={o.value} style={[styles.segItem, o.value === value && styles.segItemOn]} onPress={() => onChange(o.value)} accessibilityState={{ selected: o.value === value }}>
          <Text style={[styles.segText, o.value === value && { color: "#fff" }]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** A labelled single-choice list (the mobile counterpart of a <select>). */
export function Choice({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <TouchableOpacity key={o.value} style={[styles.chip, o.value === value && styles.chipOn]} onPress={() => onChange(o.value)} accessibilityState={{ selected: o.value === value }}>
            <Text style={[styles.chipText, o.value === value && { color: colors.paper }]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export interface DropdownOption {
  value: string;
  label: string;
  /** Second line under the label (e.g. the rate). */
  sublabel?: string;
  /** Shown but not selectable (e.g. a card type with no rate yet). */
  disabled?: boolean;
}

/** A drop-down: tap the field, pick from a scrollable sheet. React Native has no native <select>. */
export function Dropdown({ label, placeholder = "Select…", options, value, onChange, error }: {
  label: string;
  placeholder?: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, styles.dropdownField]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
      >
        <Text style={{ flexShrink: 1, fontFamily: fonts.bodyRegular, fontSize: 15, color: selected ? colors.ink : colors.inkSoft }}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={{ color: colors.inkSoft }}>▾</Text>
      </TouchableOpacity>
      {!!error && <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text>}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.line }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  disabled={item.disabled}
                  style={[styles.sheetItem, item.disabled && { opacity: 0.4 }]}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  accessibilityState={{ selected: item.value === value, disabled: item.disabled }}
                >
                  <View style={{ flexShrink: 1 }}>
                    <Text style={[styles.sheetItemText, item.value === value && { fontFamily: fonts.bodySemiBold }]}>{item.label}</Text>
                    {!!item.sublabel && <Text style={styles.sheetItemSub}>{item.sublabel}</Text>}
                  </View>
                  {item.value === value && <Text style={{ color: colors.indigo, fontSize: 16 }}>✓</Text>}
                </TouchableOpacity>
              )}
            />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function SummaryList({ rows }: { rows: { label: string; value: string; mono?: boolean }[] }) {
  return (
    <View style={styles.summary}>
      {rows.map((r, i) => (
        <View key={r.label + i} style={[styles.summaryRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
          <Text style={styles.summaryLabel}>{r.label}</Text>
          <Text selectable style={[styles.summaryValue, r.mono && { fontFamily: fonts.monoSemiBold, fontSize: 12 }]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function BackLink({ onPress, label = "← Back" }: { onPress: () => void; label?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ marginBottom: 12 }}>
      <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSoft }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, marginBottom: 18 },
  sectionTitle: { fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink, marginTop: 28, marginBottom: 12 },
  field: { marginBottom: 16 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.inkSoft, marginBottom: 6 },
  input: { fontFamily: fonts.bodyRegular, fontSize: 15, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.paperRaised, paddingVertical: 11, paddingHorizontal: 12 },
  hint: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft, marginTop: 6 },
  primary: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  primaryText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: "#17130A" },
  secondary: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  secondaryText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink },
  message: { borderRadius: 6, padding: 12, marginVertical: 8 },
  messageText: { fontFamily: fonts.bodyRegular, fontSize: 14 },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: "hidden", marginBottom: 20 },
  segItem: { flex: 1, paddingVertical: 10, alignItems: "center" },
  segItemOn: { backgroundColor: colors.indigo },
  segText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.inkSoft },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 100, paddingVertical: 7, paddingHorizontal: 13, backgroundColor: colors.paperRaised },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.ink },
  dropdownField: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { maxHeight: "75%", backgroundColor: colors.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 28 },
  sheetTitle: { fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink, marginBottom: 8 },
  sheetItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 14 },
  sheetItemText: { fontFamily: fonts.bodyRegular, fontSize: 15, color: colors.ink },
  sheetItemSub: { fontFamily: fonts.bodyRegular, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  summary: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, marginBottom: 16, backgroundColor: colors.paperRaised },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 10, paddingHorizontal: 14 },
  summaryLabel: { fontFamily: fonts.bodyRegular, fontSize: 14, color: colors.inkSoft },
  summaryValue: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1, textAlign: "right" },
});

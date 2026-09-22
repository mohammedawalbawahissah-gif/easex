/**
 * Design tokens mirroring web/src/index.css — same palette, same
 * type roles, so EaseX reads as one product across platforms even
 * though the underlying rendering (CSS vs StyleSheet) is different.
 */
export const colors = {
  ink: "#15171F",
  inkSoft: "#565B6B",
  paper: "#FAF7F2",
  paperRaised: "#FFFFFF",
  line: "#E4E0D8",
  gold: "#C98A2C",
  goldDeep: "#9C6A1E",
  indigo: "#1F3A5F",
  success: "#2F7A4D",
  successBg: "#E9F3EC",
  danger: "#B23A2E",
  dangerBg: "#FBEBE9",
  warningBg: "#FBF0DC",
};

// Font family names as exported by the @expo-google-fonts packages —
// must match exactly what useFonts() registers in app/_layout.tsx.
export const fonts = {
  displaySemiBold: "Sora_600SemiBold",
  displayBold: "Sora_700Bold",
  bodyRegular: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemiBold: "IBMPlexSans_600SemiBold",
  monoSemiBold: "IBMPlexMono_600SemiBold",
};

export const statusColors: Record<string, { bg: string; fg: string }> = {
  settled: { bg: colors.successBg, fg: colors.success },
  verified: { bg: colors.successBg, fg: colors.success },
  approved: { bg: colors.successBg, fg: colors.success },
  cleared: { bg: colors.successBg, fg: colors.success },
  pending: { bg: colors.warningBg, fg: "#8A5A12" },
  under_review: { bg: colors.warningBg, fg: "#8A5A12" },
  open: { bg: colors.warningBg, fg: "#8A5A12" },
  reviewing: { bg: colors.warningBg, fg: "#8A5A12" },
  rejected: { bg: colors.dangerBg, fg: colors.danger },
  flagged: { bg: colors.dangerBg, fg: colors.danger },
  escalated: { bg: colors.dangerBg, fg: colors.danger },
};

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pending",
    under_review: "Under review",
    verified: "Verified",
    settled: "Settled",
    approved: "Approved",
    rejected: "Rejected",
    flagged: "Flagged",
    open: "Open",
    reviewing: "Reviewing",
    cleared: "Cleared",
    escalated: "Escalated",
  };
  return labels[status] ?? status;
}

import { useId } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Circle, Rect, Line, Defs, LinearGradient, Stop } from "react-native-svg";
import { colors, fonts } from "../theme";

interface Point {
  label: string;
  value: number;
}

interface SparkChartProps {
  points: Point[];
  kind?: "line" | "bar";
  height?: number;
  valueFormatter?: (v: number) => string;
  emptyMessage?: string;
  showChangeBadge?: boolean;
}

const WIDTH = 320;

function smoothPath(coords: [number, number][]): string {
  if (coords.length < 2) return "";
  let d = `M ${coords[0][0]},${coords[0][1]}`;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const midX = (x0 + x1) / 2;
    d += ` Q ${midX},${y0} ${midX},${(y0 + y1) / 2} Q ${midX},${y1} ${x1},${y1}`;
  }
  return d;
}

export default function SparkChart({
  points,
  kind = "line",
  height = 120,
  valueFormatter = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  emptyMessage = "Not enough data yet.",
  showChangeBadge = true,
}: SparkChartProps) {
  const gradientId = useId();

  if (points.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }

  if (points.length === 1) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Not enough history yet — {valueFormatter(points[0].value)}.</Text>
      </View>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 12;
  const innerH = height - padY * 2;

  const xFor = (i: number) => (i / (points.length - 1)) * WIDTH;
  const yFor = (v: number) => padY + innerH - ((v - min) / range) * innerH;

  // Three evenly spaced horizontal reference lines (high / mid / low),
  // mirroring the web chart.
  const gridLines = [0, 0.5, 1].map((t) => padY + innerH * t);

  const last = points[points.length - 1];
  const first = points[0];
  const trendUp = last.value >= first.value;
  const trendColor = trendUp ? colors.success : colors.danger;
  const pctChange = first.value !== 0 ? ((last.value - first.value) / Math.abs(first.value)) * 100 : 0;

  const coords: [number, number][] = points.map((p, i) => [xFor(i), yFor(p.value)]);
  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${xFor(points.length - 1)},${height - padY} L ${xFor(0)},${height - padY} Z`;

  return (
    <View>
      {showChangeBadge && kind === "line" && (
        <View style={styles.header}>
          <Text style={styles.currentValue}>{valueFormatter(last.value)}</Text>
          <View style={[styles.changeBadge, { backgroundColor: trendUp ? colors.successBg : colors.dangerBg }]}>
            <Text style={[styles.changeBadgeText, { color: trendColor }]}>
              {trendUp ? "▲" : "▼"} {Math.abs(pctChange).toFixed(2)}%
            </Text>
          </View>
        </View>
      )}
      <Svg width="100%" height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
        {gridLines.map((y, i) => (
          <Line
            key={i}
            x1={0}
            x2={WIDTH}
            y1={y}
            y2={y}
            stroke={colors.line}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}
        {kind === "bar" ? (
          points.map((p, i) => {
            const barW = (WIDTH / points.length) * 0.6;
            const x = xFor(i) - barW / 2;
            const y = yFor(p.value);
            return (
              <Rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={height - padY - y}
                fill={colors.gold}
                opacity={0.85}
                rx={2}
              />
            );
          })
        ) : (
          <>
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={trendColor} stopOpacity={0.28} />
                <Stop offset="100%" stopColor={trendColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
            <Path d={linePath} fill="none" stroke={trendColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <Circle cx={xFor(points.length - 1)} cy={yFor(last.value)} r={3.5} fill={trendColor} />
          </>
        )}
      </Svg>
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>{first.label}</Text>
        {!showChangeBadge && (
          <Text style={[styles.footerValue, { color: trendColor }]}>{valueFormatter(last.value)}</Text>
        )}
        <Text style={styles.footerLabel}>{last.label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { justifyContent: "center" },
  emptyText: { fontFamily: fonts.bodyRegular, fontSize: 13, color: colors.inkSoft },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  footerLabel: { fontFamily: fonts.bodyRegular, fontSize: 11, color: colors.inkSoft },
  footerValue: { fontFamily: fonts.monoSemiBold, fontSize: 13 },
  header: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 4 },
  currentValue: { fontFamily: fonts.monoSemiBold, fontSize: 20, color: colors.ink },
  changeBadge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 100 },
  changeBadgeText: { fontFamily: fonts.monoSemiBold, fontSize: 12 },
});

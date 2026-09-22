import { useId } from "react";

/**
 * Chart for the balance-history / rate / value-trend visualizations.
 * Deliberately not a full charting library — these are simple
 * single-series trends, and a hand-rolled inline <svg> keeps the
 * bundle light and matches the app's exact palette/fonts. Renders a
 * smoothed line with a gradient fill and a prominent % change badge,
 * in the spirit of a real exchange's price chart.
 */
interface Point {
  label: string; // shown on hover / as an axis hint
  value: number;
}

interface SparkChartProps {
  points: Point[];
  kind?: "line" | "bar";
  color?: string;
  height?: number;
  valueFormatter?: (v: number) => string;
  emptyMessage?: string;
  showChangeBadge?: boolean;
}

const WIDTH = 600;

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
  color = "var(--gold)",
  height = 140,
  valueFormatter = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  emptyMessage = "Not enough data yet.",
  showChangeBadge = true,
}: SparkChartProps) {
  const gradientId = useId();

  if (points.length === 0) {
    return (
      <div className="spark-empty" style={{ height }}>
        {emptyMessage}
      </div>
    );
  }

  if (points.length === 1) {
    return (
      <div className="spark-empty" style={{ height }}>
        Not enough history yet — {valueFormatter(points[0].value)}.
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // avoid divide-by-zero on a flat series
  const padY = 14;
  const padLeft = 8;
  const innerH = height - padY * 2;

  const xFor = (i: number) => padLeft + (i / (points.length - 1)) * (WIDTH - padLeft);
  const yFor = (v: number) => padY + innerH - ((v - min) / range) * innerH;

  // Three evenly spaced horizontal reference lines (high / mid / low)
  // give the eye something to measure the trend against, the way a
  // real exchange chart does.
  const gridLines = [0, 0.5, 1].map((t) => ({
    y: padY + innerH * t,
    value: max - range * t,
  }));

  const last = points[points.length - 1];
  const first = points[0];
  const trendUp = last.value >= first.value;
  const trendColor = trendUp ? "var(--success)" : "var(--danger)";
  const pctChange = first.value !== 0 ? ((last.value - first.value) / Math.abs(first.value)) * 100 : 0;

  const coords: [number, number][] = points.map((p, i) => [xFor(i), yFor(p.value)]);
  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${xFor(points.length - 1)},${height - padY} L ${xFor(0)},${height - padY} Z`;

  return (
    <div>
      {showChangeBadge && kind === "line" && (
        <div className="spark-header">
          <span className="spark-current-value">{valueFormatter(last.value)}</span>
          <span className={`spark-change-badge ${trendUp ? "spark-change-up" : "spark-change-down"}`}>
            {trendUp ? "▲" : "▼"} {Math.abs(pctChange).toFixed(2)}%
          </span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Chart from ${valueFormatter(first.value)} to ${valueFormatter(last.value)}`}
      >
        <g className="spark-grid">
          {gridLines.map((g, i) => (
            <line
              key={i}
              x1={0}
              x2={WIDTH}
              y1={g.y}
              y2={g.y}
              stroke="var(--line)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}
        </g>
        {kind === "bar" ? (
          points.map((p, i) => {
            const barW = (WIDTH / points.length) * 0.6;
            const x = xFor(i) - barW / 2;
            const y = yFor(p.value);
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={height - padY - y}
                fill={color}
                opacity={0.85}
                rx={2}
              />
            );
          })
        ) : (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={trendColor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
            <path d={linePath} fill="none" stroke={trendColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={xFor(points.length - 1)} cy={yFor(last.value)} r={3.5} fill={trendColor} />
          </>
        )}
      </svg>
      <div className="spark-footer">
        <span>{first.label}</span>
        {!showChangeBadge && (
          <span className={trendUp ? "spark-trend-up" : "spark-trend-down"}>{valueFormatter(last.value)}</span>
        )}
        <span>{last.label}</span>
      </div>
    </div>
  );
}

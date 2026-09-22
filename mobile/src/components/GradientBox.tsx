import { useId, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/**
 * The gradient for a CSS `linear-gradient(135deg, from, to)`, so the app's tiles look the same as the web's.
 * React Native has no built-in gradient; this draws one with react-native-svg (already used by the charts).
 *
 * Drop it in as the FIRST child of a view that has `overflow: "hidden"` and a `borderRadius`; it fills that view.
 *
 * CSS gradients at an angle aren't corner-to-corner: the gradient line runs at exactly 135° through the centre,
 * with length (w + h) / √2 so the top-left corner gets `from` and the bottom-right corner gets `to`. That depends
 * on the box's real size, so it is measured on layout. (Before the first measurement it draws nothing and the
 * parent's own background colour shows for a frame.)
 */
export function gradientLine(width: number, height: number) {
  const half = (width + height) / Math.SQRT2 / 2; // half the gradient line's length
  const cx = width / 2;
  const cy = height / 2;
  const d = Math.SQRT1_2; // unit direction of 135deg is (sin, -cos) = (√½, √½)
  return { x1: cx - d * half, y1: cy - d * half, x2: cx + d * half, y2: cy + d * half };
}

export default function GradientBox({ from, to }: { from: string; to: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // useId() returns something like ":r1:", and colons aren't safe inside url(#...).
  const gradientId = "g" + useId().replace(/[^a-zA-Z0-9]/g, "");

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((cur) => (cur && cur.w === width && cur.h === height ? cur : { w: width, h: height }));
  };

  const line = size ? gradientLine(size.w, size.h) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size && line && (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill={`url(#${gradientId})`} />
        </Svg>
      )}
    </View>
  );
}

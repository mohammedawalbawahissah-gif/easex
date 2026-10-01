import { useId, type ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { BRAND_ICON_VIEWBOX, brandIconScene, type BrandIconNode, type BrandIconVariant } from "@easex/shared";

const TAGS: Record<BrandIconNode["tag"], ComponentType<any>> = {
  g: G,
  rect: Rect,
  path: Path,
  circle: Circle,
  clipPath: ClipPath,
  linearGradient: LinearGradient,
  stop: Stop,
};

function renderNode(node: BrandIconNode, key: number) {
  const Tag = TAGS[node.tag];
  return (
    <Tag key={key} {...node.props}>
      {node.children?.map(renderNode)}
    </Tag>
  );
}

/**
 * The EaseX app icon — same artwork as the launcher icons and as web's AppIcon, drawn from the shared definition
 * in @easex/shared so the two platforms can't drift apart. Below ~44px it switches to a simplified composition
 * that stays legible; pass `variant` to force one. Decorative (hidden from screen readers) — the name "EaseX"
 * is always written next to it.
 */
export default function AppIcon({
  size = 32,
  variant,
  style,
}: {
  size?: number;
  variant?: BrandIconVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const uid = useId();
  const scene = brandIconScene(variant ?? (size < 44 ? "small" : "full"), uid);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${BRAND_ICON_VIEWBOX} ${BRAND_ICON_VIEWBOX}`}
      style={style}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>{scene.defs.map(renderNode)}</Defs>
      {scene.body.map(renderNode)}
    </Svg>
  );
}

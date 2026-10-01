import { useId, type CSSProperties, type ElementType } from "react";
import { BRAND_ICON_VIEWBOX, brandIconScene, type BrandIconNode, type BrandIconVariant } from "@easex/shared";

function renderNode(node: BrandIconNode, key: number) {
  const Tag = node.tag as ElementType;
  return (
    <Tag key={key} {...node.props}>
      {node.children?.map(renderNode)}
    </Tag>
  );
}

/**
 * The EaseX app icon — the same artwork as the launcher / favicon files, drawn from the shared definition in
 * @easex/shared (so web and mobile can't drift apart). Below ~44px it switches to a simplified composition
 * that stays legible; pass `variant` to force one. Decorative by default (the name "EaseX" is always written
 * next to it); pass `title` where it stands alone.
 */
export default function AppIcon({
  size = 32,
  variant,
  title,
  className,
  style,
}: {
  size?: number;
  variant?: BrandIconVariant;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const uid = useId();
  const scene = brandIconScene(variant ?? (size < 44 ? "small" : "full"), uid);
  return (
    <svg
      viewBox={`0 0 ${BRAND_ICON_VIEWBOX} ${BRAND_ICON_VIEWBOX}`}
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {title && <title>{title}</title>}
      <defs>{scene.defs.map(renderNode)}</defs>
      {scene.body.map(renderNode)}
    </svg>
  );
}

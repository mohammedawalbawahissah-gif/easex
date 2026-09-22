import type { GiftCardBrand, GiftCardCategory, GiftCardSubcategory } from "../types/giftcard";

/** Order categories appear in the filter chips. */
export const GIFTCARD_CATEGORY_ORDER: GiftCardCategory[] = [
  "shopping",
  "gaming",
  "apps_entertainment",
  "fashion_beauty",
  "food_travel",
  "prepaid",
];

/**
 * GHS payout for a card: value x rate, rounded DOWN to the pesewa. Mirrors the
 * server exactly (apps/giftcards/services.py payout_for) so the estimate shown
 * before submitting matches what will actually be paid.
 */
export function estimateGiftCardPayout(value: string | number, rate: string | number | null): number | null {
  const v = Number(value);
  const r = Number(rate);
  if (rate === null || !Number.isFinite(v) || v <= 0 || !Number.isFinite(r) || r <= 0) return null;
  return Math.floor(v * r * 100 + 1e-9) / 100;
}

/** Why a face value isn't allowed for this subcategory, or null if it's fine. */
export function faceValueProblem(value: string, sub: GiftCardSubcategory): string | null {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return "Enter a valid amount";
  if (sub.min_value !== null && v < Number(sub.min_value)) return `The minimum for this card type is ${sub.min_value} ${sub.currency}`;
  if (sub.max_value !== null && v > Number(sub.max_value)) return `The maximum for this card type is ${sub.max_value} ${sub.currency}`;
  return null;
}

/** Brands filtered by a search string and/or category (either may be empty). */
export function filterBrands(brands: GiftCardBrand[], query: string, category: GiftCardCategory | ""): GiftCardBrand[] {
  const q = query.trim().toLowerCase();
  return brands.filter(
    (b) =>
      (!category || b.category === category) &&
      (!q || b.name.toLowerCase().includes(q) || b.slug.replace(/_/g, " ").includes(q))
  );
}

/** Short label for the dropdown: "USA · E-code — USD", with unpriced ones marked. */
export function subcategoryLabel(sub: GiftCardSubcategory): string {
  return `${sub.name} (${sub.currency})${sub.available ? "" : " — unavailable"}`;
}

/** Colours used when a brand's own aren't known (e.g. an old submission whose brand has since been removed). */
export const DEFAULT_BRAND_COLORS = { from: "#565b6b", to: "#7a8194" } as const;

// Words that add nothing to a monogram: "Visa gift card" should read "Vi", not "VG".
const GLYPH_FILLER = new Set(["gift", "card", "cards"]);

/**
 * A short monogram for a brand tile — deliberately NOT a real logo (trademark risk, and no logo
 * assets), just enough that a tile reads as "a brand" at a glance. Derived from the name so it
 * works for every catalog brand, including ones added later in Django admin.
 *
 *   Amazon -> Am   Google Play -> GP   PlayStation -> PS   eBay -> eB   Apple / iTunes -> Ap
 */
export function brandGlyph(name: string): string {
  const words = name
    .split("/")[0] // "Apple / iTunes" -> "Apple"
    .replace(/['\u2019]/g, "") // Macy's -> Macys
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !GLYPH_FILLER.has(w.toLowerCase()));
  if (words.length === 0) return "?";
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();

  const word = words[0];
  const inner = word.slice(1).search(/[A-Z]/); // camelCase: PlayStation, eBay, JCPenney, OffGamers
  if (inner >= 0) return word[0] + word[inner + 1];
  return word[0].toUpperCase() + (word[1] ?? "").toLowerCase();
}

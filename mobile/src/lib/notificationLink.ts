import type { Notification } from "@easex/shared";

type Target = string | { pathname: string; params?: Record<string, string> };

/**
 * Where tapping this notification should actually go, or null if there's
 * nothing more specific than the generic detail page. One place for this
 * mapping — used by the notifications list, the push-tap handler, and
 * NotificationDetail's own fallback — so adding a new related_type only
 * means updating this function, not every tap site separately.
 *
 * `isStaff` matters for "support_session": the same related_type covers
 * both "an admin needs to see this escalation" and "a customer got a
 * reply". There's no dedicated customer-facing support screen on mobile
 * (just the floating widget, which isn't a route you can navigate to) —
 * so for a non-staff user this returns null and the tap falls through to
 * the generic notification detail instead of a broken link.
 */
export function resolveNotificationTarget(n: Notification, isStaff: boolean): Target | null {
  switch (n.related_type) {
    case "transaction":
      return n.related_id ? `/transaction/${n.related_id}` : null;
    case "verification":
      return "/verification";
    case "payouts":
      return "/payouts";
    case "scheduled":
      return "/scheduled";
    case "security":
      return "/security";
    case "support_session":
      if (!isStaff || !n.related_id) return null;
      return { pathname: "/admin/support", params: { session: n.related_id } };
    default:
      return null;
  }
}

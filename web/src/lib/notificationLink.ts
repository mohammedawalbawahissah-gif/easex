import type { Notification } from "@easex/shared";

/**
 * Where tapping this notification should actually go, or null if there's
 * nothing more specific than the generic detail page. One place for this
 * mapping — used by the bell dropdown, the full notifications list, and
 * NotificationDetail's own fallback — so adding a new related_type only
 * means updating this function, not every tap site separately.
 *
 * `isStaff` matters for "support_session": the same related_type covers
 * both "an admin needs to see this escalation" and "a customer got a
 * reply", and those go to different places.
 */
export function resolveNotificationPath(n: Notification, isStaff: boolean): string | null {
  switch (n.related_type) {
    case "transaction":
      return n.related_id ? `/transactions/${n.related_id}` : null;
    case "verification":
      return "/verification";
    case "payouts":
      return "/payouts";
    case "scheduled":
      return "/wallet/scheduled";
    case "security":
      return "/security";
    case "support_session":
      if (!n.related_id) return null;
      return isStaff ? `/admin/support?session=${n.related_id}` : "/support";
    default:
      return null;
  }
}

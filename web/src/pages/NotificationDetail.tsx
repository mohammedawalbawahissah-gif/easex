import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import type { Notification } from "@easex/shared";
import { easex } from "../lib/easexClient";
import AppShell from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { resolveNotificationPath } from "../lib/notificationLink";

const CATEGORY_LABELS: Record<string, string> = {
  transaction_update: "Transaction update",
  kyc_update: "Verification update",
  system: "System",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [notification, setNotification] = useState<Notification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    easex.notifications
      .get(id)
      .then((n) => {
        if (cancelled) return;
        // Fallback deep-link: the bell dropdown and full list both
        // redirect before ever reaching this page, but if anything else
        // lands here with a linked notification, send it somewhere real
        // instead of showing a generic detail page.
        const target = resolveNotificationPath(n, !!user?.is_staff);
        if (target) {
          navigate(target, { replace: true });
          return;
        }
        setNotification(n);
        if (!n.is_read) easex.notifications.markRead(id).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this notification.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate, user]);

  return (
    <AppShell>
      <Link to="/notifications" style={{ fontSize: 14, color: "var(--ink-soft)" }}>
        ← Back to notifications
      </Link>

      {loading ? (
        <p style={{ marginTop: 20 }}>Loading…</p>
      ) : error || !notification ? (
        <p className="form-error" role="alert" style={{ marginTop: 20 }}>
          {error ?? "Notification not found."}
        </p>
      ) : (
        <>
          <h1 style={{ fontSize: 22, marginTop: 16, marginBottom: 4 }}>{notification.title}</h1>
          <p style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 20 }}>
            {formatDateTime(notification.created_at)}
          </p>

          {notification.body && (
            <p style={{ fontSize: 15, lineHeight: 1.6 }}>{notification.body}</p>
          )}

          <h2 className="section-title">Details</h2>
          <div className="passbook">
            <div className="passbook-row">
              <span className="passbook-row-title">Category</span>
              <span className="passbook-row-meta">
                {CATEGORY_LABELS[notification.category] ?? notification.category}
              </span>
            </div>
            <div className="passbook-row">
              <span className="passbook-row-title">Received</span>
              <span className="passbook-row-meta">{formatDateTime(notification.created_at)}</span>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

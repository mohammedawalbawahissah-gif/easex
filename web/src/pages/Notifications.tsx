import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Notification } from "@easex/shared";
import { easex } from "../lib/easexClient";
import AppShell from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { resolveNotificationPath } from "../lib/notificationLink";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Notifications() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    easex.notifications
      .list()
      .then(setNotifications)
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = async (n: Notification) => {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      easex.notifications.markRead(n.id).catch(() => {
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: false } : x)));
      });
    }
    const target = resolveNotificationPath(n, !!user?.is_staff);
    navigate(target ?? `/notifications/${n.id}`);
  };

  return (
    <AppShell>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Notifications</h1>

      <div className="passbook">
        {loading ? (
          <div className="empty-row">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="empty-row">You're all caught up.</div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className="passbook-row"
              style={{ cursor: "pointer", alignItems: "flex-start" }}
              onClick={() => handleOpen(n)}
            >
              <div className="passbook-row-main">
                <span
                  className="passbook-row-title"
                  style={{ fontWeight: n.is_read ? 400 : 600 }}
                >
                  {n.title}
                </span>
                {n.body && <span className="passbook-row-meta">{n.body}</span>}
              </div>
              <span className="passbook-row-meta">{timeAgo(n.created_at)}</span>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

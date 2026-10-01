import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import type { Notification } from "@easex/shared";
import { useAuth } from "../context/AuthContext";
import { easex } from "../lib/easexClient";
import { resolveNotificationPath } from "../lib/notificationLink";
import AppIcon from "./AppIcon";

const TIER_LABELS: Record<string, string> = {
  unverified: "Unverified",
  basic: "Basic",
  full: "Full",
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Shared header + nav for every authenticated page. Wallet / Trade /
 * Gift cards stay as ordinary nav links; Notifications and Account
 * live behind icon buttons that expand into a panel in place, so
 * neither takes up permanent space in the top nav.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [openPanel, setOpenPanel] = useState<"notifications" | "account" | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    easex.notifications
      .list()
      .then((list) => {
        if (!cancelled) setNotifications(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!openPanel) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenPanel(null);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openPanel]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleOpenNotification = async (n: Notification) => {
    setOpenPanel(null);
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      easex.notifications.markRead(n.id).catch(() => {});
    }
    const target = resolveNotificationPath(n, !!user?.is_staff);
    navigate(target ?? `/notifications/${n.id}`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <span className="brand brand-lockup">
          <AppIcon size={32} />
          <span>
            Ease<span className="brand-gold">X</span>
          </span>
        </span>
        <nav className="page-nav">
          <NavLink to="/wallet" className={({ isActive }) => (isActive ? "active" : "")}>
            Wallet
          </NavLink>
          <NavLink to="/trade" className={({ isActive }) => (isActive ? "active" : "")}>
            Trade
          </NavLink>
          <NavLink to="/giftcards" className={({ isActive }) => (isActive ? "active" : "")}>
            Gift cards
          </NavLink>
        </nav>

        <div className="header-icons" ref={containerRef}>
          <div className="icon-menu">
            <button
              type="button"
              className="icon-btn"
              aria-label="Notifications"
              aria-expanded={openPanel === "notifications"}
              onClick={() => setOpenPanel((p) => (p === "notifications" ? null : "notifications"))}
            >
              <BellIcon />
              {unreadCount > 0 && <span className="icon-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {openPanel === "notifications" && (
              <div className="icon-panel">
                <div className="icon-panel-title">Notifications</div>
                {notifications.length === 0 ? (
                  <div className="icon-panel-empty">You're all caught up.</div>
                ) : (
                  <div className="icon-panel-list">
                    {notifications.slice(0, 6).map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="icon-panel-row"
                        onClick={() => handleOpenNotification(n)}
                      >
                        <span
                          className="icon-panel-row-title"
                          style={{ fontWeight: n.is_read ? 400 : 600 }}
                        >
                          {n.title}
                        </span>
                        <span className="icon-panel-row-meta">{timeAgo(n.created_at)}</span>
                      </button>
                    ))}
                  </div>
                )}
                <Link to="/notifications" className="icon-panel-footer" onClick={() => setOpenPanel(null)}>
                  View all
                </Link>
              </div>
            )}
          </div>

          <div className="icon-menu">
            <button
              type="button"
              className="icon-btn"
              aria-label="Account"
              aria-expanded={openPanel === "account"}
              onClick={() => setOpenPanel((p) => (p === "account" ? null : "account"))}
            >
              <PersonIcon />
            </button>
            {openPanel === "account" && user && (
              <div className="icon-panel">
                <div className="icon-panel-title">{user.username}</div>
                <div className="icon-panel-sub">{user.email}</div>
                <span
                  className={`status-pill status-${user.kyc_tier === "unverified" ? "rejected" : user.kyc_tier === "basic" ? "pending" : "verified"}`}
                  style={{ marginTop: 8 }}
                >
                  {TIER_LABELS[user.kyc_tier]}
                </span>
                <Link to="/account" className="icon-panel-link" onClick={() => setOpenPanel(null)}>
                  Manage account
                </Link>
                {user.kyc_tier !== "full" && (
                  <Link to="/verification" className="icon-panel-link" onClick={() => setOpenPanel(null)}>
                    Verify your account
                  </Link>
                )}
                {user.is_staff && (
                  <Link to="/admin" className="icon-panel-link" onClick={() => setOpenPanel(null)}>
                    Admin portal
                  </Link>
                )}
                <button type="button" className="icon-panel-logout" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

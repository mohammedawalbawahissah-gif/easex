import { useState, type ReactNode } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/kyc", label: "Verification" },
  { to: "/admin/giftcards", label: "Gift cards" },
  { to: "/admin/transactions", label: "Transactions" },
  { to: "/admin/compliance", label: "Compliance flags" },
  { to: "/admin/support", label: "Support" },
  { to: "/admin/copilot", label: "Copilot" },
  { to: "/admin/users", label: "Users" },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Only matters below the mobile breakpoint (see .admin-sidebar in
  // index.css) — the sidebar is always visible above it, this state is
  // simply unused there.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="admin-shell">
      <button
        type="button"
        className="admin-sidebar-toggle"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open admin menu"
      >
        <span />
        <span />
        <span />
      </button>

      {sidebarOpen && <div className="admin-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={sidebarOpen ? "admin-sidebar admin-sidebar-open" : "admin-sidebar"}>
        <div className="admin-brand">
          Ease<span className="brand-gold">X</span> <span className="admin-brand-tag">Staff</span>
        </div>
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "admin-nav-link active" : "admin-nav-link")}
              onClick={() => setSidebarOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <Link to="/wallet" className="admin-sidebar-link" onClick={() => setSidebarOpen(false)}>
            ← Back to app
          </Link>
          <div className="admin-sidebar-user">{user?.username}</div>
          <button type="button" className="admin-sidebar-logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="admin-content">{children}</main>
    </div>
  );
}

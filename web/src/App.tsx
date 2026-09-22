import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { listenForNotificationTaps } from "./lib/webPush";
import RequireAuth from "./RequireAuth";
import RequireAdmin from "./RequireAdmin";
import FloatingSupportWidget from "./components/FloatingSupportWidget";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import WalletHome from "./pages/WalletHome";
import GiftCards from "./pages/GiftCards";
import Notifications from "./pages/Notifications";
import NotificationDetail from "./pages/NotificationDetail";
import Profile from "./pages/Profile";
import Verification from "./pages/Verification";
import TransactionDetail from "./pages/TransactionDetail";
import Trade from "./pages/Trade";
import AddMoney from "./pages/AddMoney";
import Withdraw from "./pages/Withdraw";
import Send from "./pages/Send";
import Scheduled from "./pages/Scheduled";
import Payouts from "./pages/Payouts";
import Security from "./pages/Security";
import Support from "./pages/Support";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminKYCQueue from "./pages/admin/KYCQueue";
import AdminGiftCardQueue from "./pages/admin/GiftCardQueue";
import AdminTransactionLedger from "./pages/admin/TransactionLedger";
import AdminComplianceFlags from "./pages/admin/ComplianceFlags";
import AdminUsers from "./pages/admin/Users";
import AdminSupportQueue from "./pages/admin/SupportQueue";
import AdminCopilot from "./pages/admin/Copilot";

export default function App() {
  useEffect(() => {
    listenForNotificationTaps();
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/wallet" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/wallet"
            element={
              <RequireAuth>
                <WalletHome />
              </RequireAuth>
            }
          />
          <Route
            path="/wallet/add"
            element={
              <RequireAuth>
                <AddMoney />
              </RequireAuth>
            }
          />
          <Route
            path="/wallet/withdraw"
            element={
              <RequireAuth>
                <Withdraw />
              </RequireAuth>
            }
          />
          <Route
            path="/wallet/send"
            element={
              <RequireAuth>
                <Send />
              </RequireAuth>
            }
          />
          <Route
            path="/wallet/scheduled"
            element={
              <RequireAuth>
                <Scheduled />
              </RequireAuth>
            }
          />
          <Route
            path="/security"
            element={
              <RequireAuth>
                <Security />
              </RequireAuth>
            }
          />
          <Route
            path="/payouts"
            element={
              <RequireAuth>
                <Payouts />
              </RequireAuth>
            }
          />
          <Route
            path="/transactions/:id"
            element={
              <RequireAuth>
                <TransactionDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/trade"
            element={
              <RequireAuth>
                <Trade />
              </RequireAuth>
            }
          />
          <Route
            path="/giftcards"
            element={
              <RequireAuth>
                <GiftCards />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <Notifications />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications/:id"
            element={
              <RequireAuth>
                <NotificationDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="/verification"
            element={
              <RequireAuth>
                <Verification />
              </RequireAuth>
            }
          />
          <Route
            path="/support"
            element={
              <RequireAuth>
                <Support />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboard />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/kyc"
            element={
              <RequireAdmin>
                <AdminKYCQueue />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/giftcards"
            element={
              <RequireAdmin>
                <AdminGiftCardQueue />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/transactions"
            element={
              <RequireAdmin>
                <AdminTransactionLedger />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/compliance"
            element={
              <RequireAdmin>
                <AdminComplianceFlags />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireAdmin>
                <AdminUsers />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/support"
            element={
              <RequireAdmin>
                <AdminSupportQueue />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/copilot"
            element={
              <RequireAdmin>
                <AdminCopilot />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/wallet" replace />} />
        </Routes>
        <FloatingSupportWidget />
      </BrowserRouter>
    </AuthProvider>
  );
}

// src/App.jsx
import { useEffect } from 'react';
import { Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import UniversalLogin from './views/auth/UniversalLogin';
import EventManagerLogin from './views/eventManager/EventManagerLogin';
import PlatformDashboard from './views/platform/PlatformDashboard';
import PlatformLogin from './views/platform/PlatformLogin';
import PhoneLogin from './views/phone/auth/Login';
import DesktopLogin from './views/desktop/auth/Login';
import { MobileGuard, DesktopGuard } from './components/guards/DeviceProtection';
import PlatformAuthGuard from './components/guards/PlatformAuthGuard';
import ProtectedRoute from './components/guards/ProtectedRoute';
import { EventProvider } from './contexts/EventContext';
import { AuthProvider } from './contexts/AuthContext';
import EventManagerDashboard from './views/eventManager/EventManagerDashboard.jsx';
import SellerManagerDashboard from './views/sellerManager/SellerManagerDashboard';
import CashierDashboard from './views/cashier/CashierDashboard';
import MerchantManagerDashboard from './views/merchantManager/MerchantManagerDashboard';
import SellerDashboard from './views/sellerDashboard/SellerDashboard';
import MerchantDashboard from './views/merchant/MerchantDashboard';
import CustomerDashboard from './views/customer/CustomerDashboard';
import PointSellerDashboard from './views/PointSellerDashboard/PointSellerDashboard';
import AuditorDashboard from './views/auditor/auditorDashboard'; // 🆕 稽核人员仪表板
import InitialSetup from './pages/InitialSetup/InitialSetup';
// ✅ 新增：导入其他Customer页面
import CustomerRegister from './views/customer/CustomerRegister';
import CustomerPayment from './views/customer/CustomerPayment';
import CustomerTransfer from './views/customer/CustomerTransfer';
import CustomerTransactions from './views/customer/CustomerTransactions';
import PointCardTopup from './views/customer/PointCardTopup';
import InitialPasswordSetup from './views/auth/InitialPasswordSetup';
import SellerManagerPhone from './views/phone/sellerManager/SellerManagerPhone';

// 手机版首页：根据角色自动跳转
const PhoneHome = () => {
  const navigate = useNavigate();
  const { eventSlug } = useParams();
  const { userProfile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!userProfile) {
      navigate(`/${eventSlug}/phone/login`, { replace: true });
      return;
    }

    const roles = userProfile.roles || [];
    const code = eventSlug;

    if (roles.includes('sellerManager')) {
      navigate(`/phone/seller-manager/${code}/dashboard`, { replace: true });
    } else if (roles.includes('seller')) {
      navigate(`/seller/${code}/dashboard`, { replace: true });
    } else if (roles.includes('pointSeller')) {
      navigate(`/pointseller/${code}/dashboard`, { replace: true });
    } else if (roles.includes('merchantOwner') || roles.includes('merchantAsist')) {
      navigate(`/merchant/${code}/dashboard`, { replace: true });
    } else if (roles.includes('customer')) {
      navigate(`/customer/${code}/dashboard`, { replace: true });
    } else {
      navigate(`/${eventSlug}/phone/login`, { replace: true });
    }
  }, [userProfile, loading, navigate, eventSlug]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
      跳转中...
    </div>
  );
};

const DesktopPlaceholder = () => (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <h2>桌面版首页</h2>
    <p>此功能将在第三阶段实现</p>
  </div>
);

// 重定向组件
const RedirectToLogin = () => {
  const { combinedCode } = useParams();
  return <Navigate to={`/login/${combinedCode}`} replace />;
};

function App() {
  console.log('Current path:', window.location.pathname);

  return (
    <Routes>
      {/* 🆕 统一登录路由 */}
      <Route path="/login/:orgEventCode" element={
        <EventProvider>
          <AuthProvider>
            <UniversalLogin />
          </AuthProvider>
        </EventProvider>
      } />

      {/* ⭐ 新增：密码设置路由 */}
      <Route
        path="/setup-passwords/:orgEventCode"
        element={
          <EventProvider>
            <AuthProvider>
              <InitialPasswordSetup />
            </AuthProvider>
          </EventProvider>
        }
      />
      {/* 📄 Event Manager 专用登录 - 重定向到统一登录 */}
      <Route path="/event-manager/:orgEventCode/login" element={<EventManagerLogin />} />

      {/* ✅ 旧路由重定向兼容 */}
      <Route path="/event-admin/:combinedCode/login" element={<RedirectToLogin />} />

      {/* 🆕 Platform Admin 登录页面 */}
      <Route path="/platform/login" element={<PlatformLogin />} />

      {/* Platform Admin 路由 */}
      <Route path="/platform/admin" element={
        <DesktopGuard>
          <PlatformAuthGuard>
            <PlatformDashboard />
          </PlatformAuthGuard>
        </DesktopGuard>
      } />

      {/* 活动路由 - 手机版登入 */}
      <Route path="/:eventSlug/phone/login" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <PhoneLogin />
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* 📱 手机版 Seller Manager */}
      <Route path="/phone/seller-manager/:orgEventCode/dashboard" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["sellerManager"]}>
                <SellerManagerPhone />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* 活动路由 - 手机版首页 */}
      <Route path="/:eventSlug/phone" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <PhoneHome />
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* 活动路由 - 桌面版登入 */}
      <Route path="/:eventSlug/desktop/login" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <DesktopLogin />
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />
      <Route path="/initial-setup" element={<InitialSetup />} />
      {/* 活动路由 - 桌面版首页 */}
      <Route path="/:eventSlug/desktop" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <DesktopPlaceholder />
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 🆕 Event Manager 仪表板 */}
      <Route path="/event-manager/:orgEventCode/dashboard" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["eventManager"]}>
                <EventManagerDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* ✅ 向后兼容 */}
      <Route path="/event-admin/:orgEventCode" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["eventManager"]}>
                <EventManagerDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 🆕 Manager Dashboards - Desktop 版本 */}
      <Route path="/seller-manager/:orgEventCode/dashboard" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["sellerManager"]}>
                <SellerManagerDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />
      <Route path="/merchant-manager/:orgEventCode/dashboard" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["merchantManager"]}>
                <MerchantManagerDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />
      <Route path="/customer-manager/:orgEventCode/dashboard" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["customerManager"]}>
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <h2>Customer Manager Dashboard</h2>
                  <p>功能开发中...</p>
                </div>
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />
      <Route path="/cashier/:orgEventCode/dashboard" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["cashier"]}>
                <CashierDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 🆕 普通用户 Dashboards - Mobile 版本 */}
      {/* ✅ 修改：带 orgEventCode 的 Seller 路由现在直接使用 SellerDashboard */}
      <Route path="/seller/:orgEventCode/dashboard" element={
        <EventProvider>
          <AuthProvider>
            <ProtectedRoute allowedRoles={["seller", "pointSeller"]}>
              <SellerDashboard />
            </ProtectedRoute>
          </AuthProvider>
        </EventProvider>
      } />

      {/* Point Seller Dashboard */}
      <Route path="/pointseller/:orgEventCode/dashboard" element={
        <EventProvider>
          <AuthProvider>
            <ProtectedRoute allowedRoles={["pointSeller"]}>
              <PointSellerDashboard />
            </ProtectedRoute>
          </AuthProvider>
        </EventProvider>
      } />

      <Route path="/merchant/:orgEventCode/dashboard" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["merchantOwner", "merchantAsist"]}>
                <MerchantDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* ✅ Customer Dashboard */}
      <Route path="/customer/:orgEventCode/dashboard" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["customer"]}>
                <CustomerDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* ✅ 新增：Customer 注册页面 */}
      <Route path="/customer/:orgEventCode/register" element={
        <MobileGuard>
          <CustomerRegister />
        </MobileGuard>
      } />

      {/* ✅ 新增：Customer 扫码付款 */}
      <Route path="/customer/:orgEventCode/payment" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["customer"]}>
                <CustomerPayment />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* ✅ 新增：Customer 点数转让 */}
      <Route path="/customer/:orgEventCode/transfer" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["customer"]}>
                <CustomerTransfer />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* ✅ 新增：Customer 点数卡充值 */}
      <Route path="/customer/:orgEventCode/topup" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["customer"]}>
                <PointCardTopup />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* ✅ 新增：Customer 交易记录 */}
      <Route path="/customer/:orgEventCode/transactions" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["customer"]}>
                <CustomerTransactions />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* ✅ 保留：简易路由（用于测试或直接访问） */}
      <Route path="/seller" element={
        <EventProvider>
          <AuthProvider>
            <ProtectedRoute allowedRoles={["seller"]}>
              <SellerDashboard />
            </ProtectedRoute>
          </AuthProvider>
        </EventProvider>
      } />

      {/* 🆕 Auditor 稽核人员仪表板 - Desktop 版本 */}
      <Route path="/auditor/:orgEventCode/dashboard" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <ProtectedRoute allowedRoles={["auditor"]}>
                <AuditorDashboard />
              </ProtectedRoute>
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 默认路由 */}
      <Route path="/" element={<Navigate to="/platform/login" replace />} />

      {/* 404 */}
      <Route path="*" element={
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{ fontSize: '4rem', margin: 0 }}>404</h1>
          <p style={{ fontSize: '1.25rem', color: '#6b7280' }}>页面不存在</p>
          <a
            href="/platform/login"
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '8px'
            }}
          >
            回到登录页
          </a>
        </div>
      } />
    </Routes>
  );
}

export default App;
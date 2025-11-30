// src/App.jsx
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import UniversalLogin from './views/auth/UniversalLogin';
import EventManagerLogin from './views/eventManager/EventManagerLogin';
import PlatformDashboard from './views/platform/PlatformDashboard';
import PlatformLogin from './views/platform/PlatformLogin';
import PhoneLogin from './views/phone/auth/Login';
import DesktopLogin from './views/desktop/auth/Login';
import { MobileGuard, DesktopGuard } from './components/guards/DeviceProtection';
import PlatformAuthGuard from './components/guards/PlatformAuthGuard';
import { EventProvider } from './contexts/EventContext';
import { AuthProvider } from './contexts/AuthContext';
import EventManagerDashboard from './views/eventManager/EventManagerDashboard.jsx';
import SellerManagerDashboard from './views/sellerManager/SellerManagerDashboard';

// Placeholder 組件（之後實現）
const PhonePlaceholder = () => (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <h2>手机版首页</h2>
    <p>此功能将在第三阶段实现</p>
  </div>
);

const DesktopPlaceholder = () => (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <h2>桌面版首页</h2>
    <p>此功能将在第三阶段实现</p>
  </div>
);

// 重定向組件 - 用於處理舊的路由
const RedirectToLogin = () => {
  const { combinedCode } = useParams();
  return <Navigate to={`/login/${combinedCode}`} replace />;
};

// 重定向組件 - Event Manager 舊路由
const RedirectToEventManagerLogin = () => {
  const { combinedCode } = useParams();
  return <Navigate to={`/event-manager/${combinedCode}/login`} replace />;
};

function App() {
  // 臨時調試
  console.log('Current path:', window.location.pathname);

  return (
    <Routes>
      {/* 🆕 統一登錄路由 - 支持所有用戶角色（除 Event Manager） */}
      <Route path="/login/:orgEventCode" element={<UniversalLogin />} />

      {/* 🆕 Event Manager 專用登錄 - 獨立頁面 */}
      <Route path="/event-manager/:orgEventCode/login" element={<EventManagerLogin />} />

      {/* ✅ 舊路由重定向相容 - 指向 Event Manager 登錄 */}
      <Route path="/event-admin/:combinedCode/login" element={<RedirectToEventManagerLogin />} />

      {/* 🆕 Platform Admin 登录页面 */}
      <Route path="/platform/login" element={<PlatformLogin />} />

      {/* Platform Admin 路由 - 添加认证保护 */}
      <Route path="/platform/admin" element={
        <DesktopGuard>
          <PlatformAuthGuard>
            <PlatformDashboard />
          </PlatformAuthGuard>
        </DesktopGuard>
      } />

      {/* 活動路由 - 手機版登入 */}
      <Route path="/:eventSlug/phone/login" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <PhoneLogin />
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* 活動路由 - 手機版首頁（需要登入） */}
      <Route path="/:eventSlug/phone" element={
        <MobileGuard>
          <EventProvider>
            <AuthProvider>
              <PhonePlaceholder />
            </AuthProvider>
          </EventProvider>
        </MobileGuard>
      } />

      {/* 活動路由 - 桌機版登入 */}
      <Route path="/:eventSlug/desktop/login" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <DesktopLogin />
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 活動路由 - 桌機版首頁（需要登入） */}
      <Route path="/:eventSlug/desktop" element={
        <DesktopGuard>
          <EventProvider>
            <AuthProvider>
              <DesktopPlaceholder />
            </AuthProvider>
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 🆕 Event Manager 儀表板 - 新路径 */}
      <Route path="/event-manager/:orgEventCode/dashboard" element={<EventManagerDashboard />} />
      
      {/* ✅ 向后兼容：旧的 event-admin 路径 */}
      <Route path="/event-admin/:orgEventCode" element={<EventManagerDashboard />} />

      {/* 🆕 Manager Dashboards - Desktop 版本 */}
      <Route path="/seller-manager/:orgEventCode/dashboard" element={<SellerManagerDashboard />} />
      <Route path="/merchant-manager/:orgEventCode/dashboard" element={<div style={{ padding: '2rem', textAlign: 'center' }}><h2>Merchant Manager Dashboard</h2><p>功能开发中...</p></div>} />
      <Route path="/customer-manager/:orgEventCode/dashboard" element={<div style={{ padding: '2rem', textAlign: 'center' }}><h2>Customer Manager Dashboard</h2><p>功能开发中...</p></div>} />

      {/* 🆕 普通用户 Dashboards - Mobile 版本 */}
      <Route path="/seller/:orgEventCode/dashboard" element={<div style={{ padding: '2rem', textAlign: 'center' }}><h2>Seller Dashboard</h2><p>功能开发中...</p></div>} />
      <Route path="/merchant/:orgEventCode/dashboard" element={<div style={{ padding: '2rem', textAlign: 'center' }}><h2>Merchant Dashboard</h2><p>功能开发中...</p></div>} />
      <Route path="/customer/:orgEventCode/dashboard" element={<div style={{ padding: '2rem', textAlign: 'center' }}><h2>Customer Dashboard</h2><p>功能开发中...</p></div>} />

      {/* 預設路由 - 重定向到 Platform Admin 登录 */}
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
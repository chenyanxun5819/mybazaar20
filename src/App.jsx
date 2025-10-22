// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import PlatformDashboard from './views/platform/PlatformDashboard';
import PhoneLogin from './views/phone/auth/Login';
import DesktopLogin from './views/desktop/auth/Login';
import { MobileGuard, DesktopGuard } from './components/guards/DeviceProtection';
import { EventProvider } from './contexts/EventContext';
import { AuthProvider } from './contexts/AuthContext';
import EventManagerLogin from './views/eventManager/EventManagerLogin.jsx';
import EventManagerDashboard from './views/eventManager/EventManagerDashboard.jsx';

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

function App() {
  // 臨時調試
  console.log('Current path:', window.location.pathname);
  
  return (
    <Routes>
      {/* Platform Admin 路由 */}
      <Route path="/platform/admin" element={
        <DesktopGuard>
          <PlatformDashboard />
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

  {/* 🆕 Event Manager 登录與儀表板 */}
      <Route path="/event-manager/login" element={<EventManagerLogin />} />
  <Route path="/event-manager/:orgEventCode/dashboard" element={<EventManagerDashboard />} />

      {/* 預設路由 */}
      <Route path="/" element={<Navigate to="/platform/admin" replace />} />
      
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
            href="/platform/admin" 
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '8px'
            }}
          >
            回到首页
          </a>
        </div>
      } />
    </Routes>
  );
}

export default App;
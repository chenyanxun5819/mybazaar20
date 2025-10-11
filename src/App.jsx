// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import PlatformDashboard from './views/platform/PlatformDashboard';
import { MobileGuard, DesktopGuard } from './components/guards/DeviceProtection';
import { EventProvider } from './contexts/EventContext';

// Placeholder 組件（之後實現）
const PhonePlaceholder = () => (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <h2>手機版首頁</h2>
    <p>此功能將在第二階段實現</p>
  </div>
);

const DesktopPlaceholder = () => (
  <div style={{ padding: '2rem', textAlign: 'center' }}>
    <h2>桌機版首頁</h2>
    <p>此功能將在第二階段實現</p>
  </div>
);

function App() {
  return (
    <Routes>
      {/* Platform Admin 路由 */}
      <Route path="/platform/admin" element={
        <DesktopGuard>
          <PlatformDashboard />
        </DesktopGuard>
      } />

      {/* 活動路由 - 手機版 */}
      <Route path="/:orgCode-:eventCode/phone" element={
        <MobileGuard>
          <EventProvider>
            <PhonePlaceholder />
          </EventProvider>
        </MobileGuard>
      } />

      {/* 活動路由 - 桌機版 */}
      <Route path="/:orgCode-:eventCode/desktop" element={
        <DesktopGuard>
          <EventProvider>
            <DesktopPlaceholder />
          </EventProvider>
        </DesktopGuard>
      } />

      {/* 預設路由 */}
      <Route path="/" element={<Navigate to="/platform/admin" replace />} />
      
      {/* 404 */}
      <Route path="*" element={
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>404</h1>
          <p>頁面不存在</p>
        </div>
      } />
    </Routes>
  );
}

export default App;
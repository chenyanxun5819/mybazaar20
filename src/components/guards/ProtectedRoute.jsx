import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ProtectedRoute = ({ allowedRoles = [], children }) => {
  const { loading, isAuthenticated, userProfile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>加载中...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // 从当前路由提取 orgEventCode（格式: /role/{orgEventCode}/dashboard）
    // ⭐ merchant 路由同时支持 merchantOwner 和 merchantAsist
    const segments = location.pathname.split('/').filter(Boolean);
    const roleSeg = (segments[0] || '').toLowerCase();
    const knownRolePaths = new Set([
      'merchant',
      'customer',
      'event-manager',
      'team-leader',
      'cashier',
      'customer-manager',
      'merchant-manager',
      'point-seller',
      'pointseller',
      'auditor'
    ]);

    const orgEventCode = knownRolePaths.has(roleSeg) ? (segments[1] || null) : null;

    // 若未登入，导向相应的登入页（而不是 /platform/login）
    if (orgEventCode) {
      return <Navigate to={`/login/${orgEventCode}`} replace />;
    } else {
      // 如果无法提取 orgEventCode，尝试从 localStorage 获取最后使用的代码
      const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
      if (lastOrgEventCode) {
        console.warn('[ProtectedRoute] 无法从URL提取orgEventCode，使用localStorage:', lastOrgEventCode);
        return <Navigate to={`/login/${lastOrgEventCode}`} replace />;
      }
      // 最后的降级方案：使用根路由（会显示帮助页面）
      console.error('[ProtectedRoute] 无法确定orgEventCode，重定向到根路由');
      return <Navigate to="/" replace />;
    }
  }

  // ✅ 已登入但 Profile/roles 尚未就緒：先顯示 loading，避免瞬間閃過「權限不足」
  if (allowedRoles.length > 0) {
    const rolesReady = Array.isArray(userProfile?.roles) && userProfile.roles.length > 0;
    if (!rolesReady) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>加载中...</p>
        </div>
      );
    }
  }

  const roles = userProfile?.roles || [];
  const has = allowedRoles.some(r => roles.includes(r));

  if (!has) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>权限不足</h2>
        <p>您的账号没有访问此页面的权限。</p>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;

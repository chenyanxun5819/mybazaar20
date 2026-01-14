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
    // 从当前路由提取 orgEventCode（格式: /seller/{orgEventCode}/dashboard）
    // ⭐ merchant 路由同时支持 merchantOwner 和 merchantAsist
    const pathMatch = location.pathname.match(/\/(seller|merchant|customer|event-manager|seller-manager|cashier|customer-manager|merchant-manager|point-seller)\/([^/]+)/);
    const orgEventCode = pathMatch ? pathMatch[2] : null;

    // 若未登入，导向相应的登入页（而不是 /platform/login）
    if (orgEventCode) {
      return <Navigate to={`/login/${orgEventCode}`} replace />;
    } else {
      // 如果无法提取 orgEventCode，才降级到 /platform/login
      return <Navigate to="/platform/login" replace />;
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
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ProtectedRoute = ({ allowedRoles = [], children }) => {
  const { loading, isAuthenticated, userProfile } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>加载中...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // 若未登入，導向首頁（可改為更合適的登入頁）
    return <Navigate to="/platform/login" replace />;
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

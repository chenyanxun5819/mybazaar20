// src/components/guards/PlatformAuthGuard.jsx
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const PlatformAuthGuard = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[PlatformAuthGuard] 开始监听认证状态');
    
    // 监听 Firebase Auth 状态变化
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log('[PlatformAuthGuard] 认证状态:', currentUser ? '已登录' : '未登录');
      console.log('[PlatformAuthGuard] 用户 UID:', currentUser?.uid);
      
      setUser(currentUser);
      setLoading(false);
    });

    // 清理订阅
    return () => unsubscribe();
  }, []);

  // 加载中显示
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>加载中...</p>
      </div>
    );
  }

  // 未登录则重定向到登录页
  if (!user) {
    console.log('[PlatformAuthGuard] 用户未登录，重定向到登录页');
    return <Navigate to="/platform/login" replace />;
  }

  // 已登录则渲染子组件
  console.log('[PlatformAuthGuard] 用户已登录，允许访问');
  return children;
};

const styles = {
  loadingContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  },
  spinner: {
    width: '50px',
    height: '50px',
    border: '4px solid rgba(255, 255, 255, 0.3)',
    borderTop: '4px solid white',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    marginTop: '1rem',
    color: 'white',
    fontSize: '1rem',
    fontWeight: '500'
  }
};

// 添加旋转动画（需要在全局 CSS 或者使用 styled-components）
// 如果你的项目有全局 CSS，可以添加这个动画：
/*
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
*/

export default PlatformAuthGuard;

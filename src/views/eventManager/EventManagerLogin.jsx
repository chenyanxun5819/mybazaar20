import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * Event Manager Login 页面 - 重定向到 UniversalLogin
 * 
 * @deprecated 此页面已废弃，Event Manager 现在使用 UniversalLogin
 * @route /event-manager/:orgEventCode/login
 * 
 * @description
 * Event Manager 已从 Event.eventManager 对象迁移到 users 集合
 * 现在使用统一登录页面 (UniversalLogin.jsx)
 * 此组件仅用于向后兼容，自动重定向到新的登录页面
 */
const EventManagerLogin = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('[EventManagerLogin] 🔄 重定向到 UniversalLogin:', orgEventCode);
    
    // 立即重定向到新的统一登录页面
    if (orgEventCode) {
      navigate(`/login/${orgEventCode}`, { replace: true });
    } else {
      // 如果没有 orgEventCode，尝试从 localStorage 获取
      const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
      if (lastOrgEventCode) {
        navigate(`/login/${lastOrgEventCode}`, { replace: true });
      } else {
        // 最后才重定向到根路由
        navigate('/', { replace: true });
      }
    }
  }, [orgEventCode, navigate]);

  // 显示重定向提示
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.spinner}>🔄</div>
        <h2 style={styles.title}>正在重定向...</h2>
        <p style={styles.message}>
          Event Manager 登录已迁移到新的统一登录页面
        </p>
        <p style={styles.hint}>
          如果页面未自动跳转，请点击下方链接
        </p>
        {orgEventCode && (
          <a 
            href={`/login/${orgEventCode}`} 
            style={styles.link}
          >
            前往登录页面 →
          </a>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '2rem'
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    padding: '3rem',
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center'
  },
  spinner: {
    fontSize: '4rem',
    marginBottom: '1rem',
    animation: 'spin 2s linear infinite'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 1rem 0'
  },
  message: {
    color: '#6b7280',
    margin: '0 0 0.5rem 0',
    fontSize: '1rem'
  },
  hint: {
    color: '#9ca3af',
    margin: '1rem 0',
    fontSize: '0.875rem'
  },
  link: {
    display: 'inline-block',
    marginTop: '1rem',
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    transition: 'all 0.2s'
  }
};

// 添加旋转动画
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default EventManagerLogin;


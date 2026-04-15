// src/components/LogoutButton.jsx
import { auth } from '../config/firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

const LogoutButton = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      console.log('[LogoutButton] 开始登出');
      await signOut(auth);
      console.log('[LogoutButton] 登出成功');
      
      // 尝试从 localStorage 获取最后使用的 orgEventCode
      const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
      if (lastOrgEventCode) {
        console.log('[LogoutButton] 重定向到事件登录页:', lastOrgEventCode);
        navigate(`/login/${lastOrgEventCode}`);
      } else {
        // 如果没有保存的 orgEventCode，显示错误页面
        console.warn('[LogoutButton] 未找到 orgEventCode，重定向到错误页面');
        navigate('/', { replace: true });
      }
    } catch (error) {
      console.error('[LogoutButton] 登出失败:', error);
      window.mybazaarShowToast('登出失败：' + error.message);
    }
  };

  return (
    <button
      onClick={handleLogout}
      style={styles.logoutButton}
      title="登出"
    >
      🚪 登出
    </button>
  );
};

const styles = {
  logoutButton: {
    padding: '0.5rem 1rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  }
};

export default LogoutButton;


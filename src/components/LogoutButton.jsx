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
      
      // 跳转到登录页
      navigate('/platform/login');
    } catch (error) {
      console.error('[LogoutButton] 登出失败:', error);
      alert('登出失败：' + error.message);
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
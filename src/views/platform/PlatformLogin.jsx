// src/views/platform/PlatformLogin.jsx
import { useState } from 'react';
import { auth } from '../../config/firebase';
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

const PlatformLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError('请填写邮箱和密码');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      console.log('[PlatformLogin] 尝试登录:', email);
      
      // 设置持久化登录状态
      await setPersistence(auth, browserLocalPersistence);
      console.log('[PlatformLogin] Auth persistence 已设置为 localStorage');
      
      // 使用 Firebase Authentication 登录
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      console.log('[PlatformLogin] 登录成功:', userCredential.user.uid);
      
      // 登录成功，跳转到 Dashboard
      navigate('/platform/admin');
      
    } catch (err) {
      console.error('[PlatformLogin] 登录失败:', err);
      
      let errorMessage = '登录失败';
      
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        errorMessage = '邮箱或密码错误';
      } else if (err.code === 'auth/user-not-found') {
        errorMessage = '用户不存在';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = '邮箱格式不正确';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage = '登录尝试次数过多，请稍后再试';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.loginBox}>
        <div style={styles.logoSection}>
          <div style={styles.logo}>🎯</div>
          <h1 style={styles.title}>Platform Admin</h1>
          <p style={styles.subtitle}>MyBazaar 管理平台</p>
        </div>
        
        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>管理员邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              style={styles.input}
              disabled={loading}
              autoComplete="email"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={styles.input}
              disabled={loading}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div style={styles.error}>
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              ...styles.loginButton,
              ...(loading ? styles.loginButtonDisabled : {})
            }}
            disabled={loading}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div style={styles.footer}>
          <p style={styles.helpText}>
            💡 提示：忘记密码请联系系统管理员
          </p>
        </div>
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
  loginBox: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    padding: '3rem',
    maxWidth: '450px',
    width: '100%'
  },
  logoSection: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  logo: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  input: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box'
  },
  error: {
    padding: '0.875rem',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  loginButton: {
    padding: '1rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.2s'
  },
  loginButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  footer: {
    marginTop: '2rem',
    textAlign: 'center'
  },
  helpText: {
    fontSize: '0.75rem',
    color: '#6b7280',
    margin: 0
  }
};

export default PlatformLogin;


// src/views/desktop/auth/Login.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useEvent } from '../../../contexts/EventContext';

const DesktopLogin = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { orgCode, eventCode, organization, event } = useEvent();

  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.phoneNumber || !formData.password) {
      setError('请填写完整的手机号和密码');
      return;
    }

    if (!/^01\d{8,9}$/.test(formData.phoneNumber)) {
      setError('手机号格式不正确，请输入01开头的10-11位数字');
      return;
    }

    if (formData.password.length < 8) {
      setError('密码至少需要8个字符');
      return;
    }

    try {
      setLoading(true);
      setError('');

      await login(formData.phoneNumber, formData.password);

      // 登录成功，跳转到桌机版首页
      navigate(`/${orgCode}-${eventCode}/desktop`);
    } catch (err) {
      console.error('[DesktopLogin] Login failed:', err);
      setError(err.message || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.leftPanel}>
        <div style={styles.brandSection}>
          <h1 style={styles.brandTitle}>
            {organization?.orgName?.['zh-CN'] || '义卖会管理系统'}
          </h1>
          <p style={styles.brandSubtitle}>
            {event?.eventName?.['zh-CN'] || '活动管理平台'}
          </p>
          <div style={styles.features}>
            <div style={styles.feature}>✓ 安全可靠</div>
            <div style={styles.feature}>✓ 简单易用</div>
            <div style={styles.feature}>✓ 实时更新</div>
          </div>
        </div>
      </div>

      <div style={styles.rightPanel}>
        <div style={styles.loginCard}>
          <div style={styles.header}>
            <h2 style={styles.title}>欢迎回来</h2>
            <p style={styles.subtitle}>请登录您的账号</p>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>手机号</label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                placeholder="01xxxxxxxx"
                style={styles.input}
                disabled={loading}
                inputMode="numeric"
                pattern="^01\d{8,9}$"
                maxLength="11"
              />
              <small style={styles.hint}>马来西亚手机号，01开头</small>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>密码</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="至少8位，包含英文和数字"
                style={styles.input}
                disabled={loading}
                minLength="8"
              />
            </div>

            {error && (
              <div style={styles.errorMessage}>
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              style={{
                ...styles.submitButton,
                ...(loading ? styles.submitButtonDisabled : {})
              }}
              disabled={loading}
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div style={styles.footer}>
            <p style={styles.footerText}>
              还没有账号？请联系管理员注册
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh'
  },
  leftPanel: {
    flex: 1,
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    color: 'white'
  },
  brandSection: {
    maxWidth: '500px'
  },
  brandTitle: {
    fontSize: '2.5rem',
    fontWeight: 'bold',
    marginBottom: '1rem',
    lineHeight: '1.2'
  },
  brandSubtitle: {
    fontSize: '1.25rem',
    opacity: 0.9,
    marginBottom: '3rem'
  },
  features: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  feature: {
    fontSize: '1.125rem',
    opacity: 0.95
  },
  rightPanel: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    background: '#f9fafb'
  },
  loginCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '3rem',
    width: '100%',
    maxWidth: '450px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)'
  },
  header: {
    marginBottom: '2rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '1rem',
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
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  input: {
    padding: '0.875rem',
    fontSize: '1rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s',
    width: '100%',
    boxSizing: 'border-box'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  errorMessage: {
    padding: '0.875rem',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  submitButton: {
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '600',
    color: 'white',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'transform 0.2s, opacity 0.2s',
    marginTop: '0.5rem'
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  footer: {
    marginTop: '2rem',
    paddingTop: '2rem',
    borderTop: '1px solid #e5e7eb',
    textAlign: 'center'
  },
  footerText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  }
};

export default DesktopLogin;
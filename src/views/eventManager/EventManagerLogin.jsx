import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
// 使用 HTTP 端點而非 callable
import { auth } from '../../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

const EventManagerLogin = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    orgCode: '',
    eventCode: '',
    phoneNumber: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 暫時直接呼叫 Cloud Functions URL，繞過 Hosting rewrites 的組織政策限制
      // const url = import.meta.env.DEV 
      //   ? 'https://us-central1-mybazaar-c4881.cloudfunctions.net/loginEventManagerHttp'
      //   : '/api/loginEventManagerHttp';
      // ✅ 加入這個 log 檢查
      console.log('Form data:', formData);
      const url = '/api/loginEventManagerHttp';
      const payload = {
        orgCode: formData.orgCode.toLowerCase(),
        eventCode: formData.eventCode,
        phoneNumber: formData.phoneNumber,
        password: formData.password
      };
  // ✅ 加入這個 log 檢查
  console.log('Payload:', payload);
  const _emStart = Date.now();

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
        // credentials: 'include' // 若後續需要 cookie，可開啟並調整 CORS 設定
      });

      // 嘗試以 JSON 解析；若不是 JSON（例如 Hosting 404 頁），則以純文字解析並拋錯，方便除錯
      const text = await resp.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        // 非 JSON 回應（可能是 404 HTML），直接把文字當錯誤訊息
        console.warn('[EventManagerLogin] Non-JSON response, status:', resp.status);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${text?.substring(0, 200) || '非 JSON 回應'}`);
        }
      }
      if (!resp.ok || !data?.success) {
        const serverMsg = data?.error?.message;
        throw new Error(serverMsg || `请求失败 (HTTP ${resp.status})`);
      }

  console.log('[EventManagerLogin] Login response:', data, 'elapsedMs:', Date.now() - _emStart);

      // 使用 Custom Token 登录 Firebase Auth
      if (data.customToken) {
        await signInWithCustomToken(auth, data.customToken);

        // 保存用户信息到 localStorage
        localStorage.setItem('eventManagerInfo', JSON.stringify({
          userId: data.userId,
          organizationId: data.organizationId,
          eventId: data.eventId,
          orgCode: formData.orgCode,
          eventCode: formData.eventCode,
          englishName: data.englishName,
          role: 'eventManager'
        }));

        // 跳转到 Event Manager Dashboard
        navigate(`/event-manager/${formData.orgCode}-${formData.eventCode}/dashboard`);
      }
    } catch (error) {
      console.error('[EventManagerLogin] Error:', error);
      // 简化错误讯息映射
      const msg = error?.message || '登录失败，请重试';
      if (/组织|活动|not[- ]?found/i.test(msg)) setError('找不到该组织或活动');
      else if (/密码|permission[- ]?denied/i.test(msg)) setError('手机号或密码错误');
      else if (/必填|invalid[- ]?argument/i.test(msg)) setError('请填写所有必填字段');
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        {/* Logo 和标题 */}
        <div style={styles.header}>
          <div style={styles.logo}>🎯</div>
          <h1 style={styles.title}>Event Manager 登录</h1>
          <p style={styles.subtitle}>管理您的活动</p>
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>组织代码 *</label>
            <input
              type="text"
              style={styles.input}
              value={formData.orgCode}
              onChange={(e) => setFormData({ ...formData, orgCode: e.target.value.toLowerCase() })}
              placeholder="例如：fch"
              required
            />
            <small style={styles.hint}>学校或组织的代码（小写字母）</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>活动代码 *</label>
            <input
              type="text"
              style={styles.input}
              value={formData.eventCode}
              onChange={(e) => setFormData({ ...formData, eventCode: e.target.value })}
              placeholder="例如：2025"
              required
            />
            <small style={styles.hint}>活动年份或代码</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>手机号 *</label>
            <input
              type="tel"
              style={styles.input}
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              placeholder="0123456789"
              required
            />
            <small style={styles.hint}>马来西亚手机号</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>密码 *</label>
            <input
              type="password"
              style={styles.input}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              required
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          {/* 登录按钮 */}
          <button
            type="submit"
            style={{
              ...styles.submitButton,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
            disabled={loading}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {/* 帮助信息 */}
        <div style={styles.footer}>
          <p style={styles.helpText}>
            忘记密码？请联系 Platform 管理员
          </p>
          <button
            style={styles.backButton}
            onClick={() => navigate('/')}
          >
            返回首页
          </button>
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
  loginCard: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    padding: '3rem',
    maxWidth: '500px',
    width: '100%'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  logo: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
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
    fontWeight: '500',
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
    ':focus': {
      borderColor: '#667eea'
    }
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  submitButton: {
    padding: '1rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '1rem'
  },
  footer: {
    marginTop: '2rem',
    textAlign: 'center'
  },
  helpText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '1rem'
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#667eea',
    fontSize: '0.875rem',
    cursor: 'pointer',
    textDecoration: 'underline'
  }
};

export default EventManagerLogin;
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, auth } from '../../config/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';

const EventManagerLogin = () => {
  const navigate = useNavigate();
  const { combinedCode } = useParams(); // 获取 "chhsban-2025" 格式的参数
  
  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: ''
  });
  
  const [orgCode, setOrgCode] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [orgId, setOrgId] = useState(''); // 保存组织 ID
  const [eventId, setEventId] = useState(''); // 保存活动 ID
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // OTP 相关状态
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);

  // 解析 URL 参数
  useEffect(() => {
    if (combinedCode) {
      const parts = combinedCode.split('-');
      if (parts.length >= 2) {
        const org = parts[0];
        const event = parts.slice(1).join('-');
        setOrgCode(org);
        setEventCode(event);
        console.log('[EventManagerLogin] 解析 URL:', { org, event });
      } else {
        setError('URL 格式不正确，应为: /event-admin/{orgCode}-{eventCode}');
      }
    }
  }, [combinedCode]);

  // SHA256 哈希函数（与后端一致）
  const sha256 = async (message) => {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError('');
  };

  const validateForm = () => {
    if (!orgCode || !eventCode) {
      setError('URL 格式不正确');
      return false;
    }

    if (!formData.phoneNumber || !formData.password) {
      setError('请填写手机号和密码');
      return false;
    }

    // 验证手机号格式（马来西亚格式）
    if (!/^01\d{8,9}$/.test(formData.phoneNumber)) {
      setError('手机号格式不正确，请输入01开头的10-11位数字');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setError('');

      console.log('[EventManagerLogin] 开始验证密码...', { orgCode, eventCode });

      // Step 1: 查找组织
      const orgsQuery = query(
        collection(db, 'organizations'),
        where('orgCode', '==', orgCode),
        limit(1)
      );
      const orgsSnapshot = await getDocs(orgsQuery);

      if (orgsSnapshot.empty) {
        throw new Error('组织代码不存在');
      }

      const orgDoc = orgsSnapshot.docs[0];
      const foundOrgId = orgDoc.id;
      setOrgId(foundOrgId); // 保存到 state

      // Step 2: 查找活动
      const eventsQuery = query(
        collection(db, 'organizations', foundOrgId, 'events'),
        where('eventCode', '==', eventCode),
        limit(1)
      );
      const eventsSnapshot = await getDocs(eventsQuery);

      if (eventsSnapshot.empty) {
        throw new Error('活动代码不存在');
      }

      const eventDoc = eventsSnapshot.docs[0];
      const foundEventId = eventDoc.id;
      setEventId(foundEventId); // 保存到 state
      const eventData = eventDoc.data();

      console.log('[EventManagerLogin] 找到活动:', foundEventId);

      // Step 3: 验证 admins 数组
      const admins = eventData.admins || [];
      
      if (admins.length === 0) {
        throw new Error('此活动没有指派 Event Manager');
      }

      // 查找匹配的管理员
      const admin = admins.find(a => a.phone === formData.phoneNumber);
      
      if (!admin) {
        throw new Error('手机号不正确或您不是此活动的 Event Manager');
      }

      console.log('[EventManagerLogin] 找到管理员:', admin.name);

      // Step 4: 验证密码
      const passwordHash = await sha256(formData.password + admin.passwordSalt);
      
      if (passwordHash !== admin.passwordHash) {
        throw new Error('密码错误');
      }

      console.log('[EventManagerLogin] 密码验证成功，准备发送 OTP');

      // Step 5: 发送 OTP
      setSendingOtp(true);
      const otpResp = await fetch('/api/sendOtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phoneNumber: formData.phoneNumber,
          orgCode: orgCode,
          eventCode: eventCode
        })
      });

      if (!otpResp.ok) {
        const errorData = await otpResp.json();
        throw new Error(errorData.error?.message || '发送 OTP 失败');
      }

      const otpData = await otpResp.json();
      setSessionId(otpData.sessionId);
      setShowOtpInput(true);
      
      console.log('[EventManagerLogin] OTP 已发送，sessionId:', otpData.sessionId);

    } catch (err) {
      console.error('[EventManagerLogin] 错误:', err);
      setError(err.message || '登录失败，请检查输入信息');
    } finally {
      setLoading(false);
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    
    if (!otpCode || otpCode.length !== 6) {
      setError('请输入6位 OTP 验证码');
      return;
    }

    try {
      setLoading(true);
      setError('');

      console.log('[EventManagerLogin] 验证 OTP...');

      // 验证 OTP
      const verifyResp = await fetch('/api/verifyOtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phoneNumber: formData.phoneNumber,
          otp: otpCode,
          orgCode: orgCode,
          eventCode: eventCode
        })
      });

      if (!verifyResp.ok) {
        const errorData = await verifyResp.json();
        throw new Error(errorData.error?.message || 'OTP 验证失败');
      }

      const { customToken } = await verifyResp.json();
      if (!customToken || typeof customToken !== 'string') {
        throw new Error('后端未返回有效 customToken');
      }

      console.log('[EventManagerLogin] 收到 customToken 長度:', customToken.length);
      // 簡單解析 JWT 結構（若格式正確應有三段）
      const parts = customToken.split('.');
      if (parts.length === 3) {
        try {
          const headerJson = JSON.parse(atob(parts[0]));
          console.log('[EventManagerLogin] Token header:', headerJson);
        } catch (_) {}
      } else {
        console.warn('[EventManagerLogin] customToken 不是標準 JWT 三段格式');
      }

      try {
        await signInWithCustomToken(auth, customToken);
      } catch (authErr) {
        console.error('[EventManagerLogin] signInWithCustomToken 失敗', {
          code: authErr.code,
          message: authErr.message,
          serverResponse: authErr?.customData?.serverResponse || null
        });
        throw authErr; // 交給外層 catch 顯示
      }

      console.log('[EventManagerLogin] 登录成功');

      // 保存登录信息到 localStorage（包含 organizationId 和 eventId）
      localStorage.setItem('eventManagerInfo', JSON.stringify({
        organizationId: orgId,
        eventId: eventId,
        orgCode: orgCode,
        eventCode: eventCode,
        phone: formData.phoneNumber,
        role: 'eventManager',
        loginAt: new Date().toISOString()
      }));

      // 跳转到 EventManagerDashboard
      navigate(`/event-manager/${orgCode}-${eventCode}/dashboard`);

    } catch (err) {
      console.error('[EventManagerLogin] OTP 或登入流程失败:', err);
      // 若是 Firebase Auth 錯誤，嘗試輸出更底層 serverResponse
      const serverResp = err?.customData?.serverResponse;
      if (serverResp) {
        try {
          const parsed = typeof serverResp === 'string' ? JSON.parse(serverResp) : serverResp;
          console.error('[EventManagerLogin] Firebase serverResponse:', parsed);
        } catch (_) {
          console.error('[EventManagerLogin] serverResponse(raw):', serverResp);
        }
      }
      setError(err.message || 'OTP 验证/登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    try {
      setSendingOtp(true);
      setError('');

      const orgsQuery = query(
        collection(db, 'organizations'),
        where('orgCode', '==', orgCode),
        limit(1)
      );
      const orgsSnapshot = await getDocs(orgsQuery);
      const orgId = orgsSnapshot.docs[0].id;

      const eventsQuery = query(
        collection(db, 'organizations', orgId, 'events'),
        where('eventCode', '==', eventCode),
        limit(1)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      const eventId = eventsSnapshot.docs[0].id;

      const otpResp = await fetch('/api/sendOtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phoneNumber: formData.phoneNumber,
          orgCode: orgCode,
          eventCode: eventCode
        })
      });

      if (!otpResp.ok) {
        throw new Error('重新发送 OTP 失败');
      }

      const otpData = await otpResp.json();
      setSessionId(otpData.sessionId);
      
      alert('OTP 已重新发送到您的手机');

    } catch (err) {
      console.error('[EventManagerLogin] 重新发送 OTP 失败:', err);
      setError(err.message || '重新发送失败');
    } finally {
      setSendingOtp(false);
    }
  };

  // 如果没有解析到 orgCode 和 eventCode，显示错误
  if (!combinedCode) {
    return (
      <div style={styles.container}>
        <div style={styles.loginBox}>
          <div style={styles.errorBox}>
            ⚠️ URL 格式错误
            <p style={styles.errorText}>
              请使用正确的格式访问：
              <br />
              <code>/event-admin/{'{orgCode}-{eventCode}'}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.loginBox}>
        {/* Logo 和标题 */}
        <div style={styles.header}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>🎪</span>
          </div>
          <h1 style={styles.title}>Event Manager 登录</h1>
          <p style={styles.subtitle}>义卖会管理系统</p>
        </div>

        {/* 活动信息显示 */}
        <div style={styles.infoBox}>
          <strong>📌 管理员登录</strong>
          <div style={styles.eventInfo}>
            <div style={styles.eventInfoRow}>
              <span style={styles.label}>组织代码:</span>
              <span style={styles.value}>{orgCode}</span>
            </div>
            <div style={styles.eventInfoRow}>
              <span style={styles.label}>活动代码:</span>
              <span style={styles.value}>{eventCode}</span>
            </div>
          </div>
        </div>

        {/* 登录表单 或 OTP 验证表单 */}
        {!showOtpInput ? (
          // 密码登录表单
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                手机号 <span style={styles.required}>*</span>
              </label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                placeholder="01xxxxxxxx"
                style={styles.input}
                disabled={loading}
                maxLength="11"
                autoComplete="tel"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                密码 <span style={styles.required}>*</span>
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="请输入密码"
                style={styles.input}
                disabled={loading}
                autoComplete="current-password"
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
              disabled={loading || sendingOtp}
            >
              {sendingOtp ? '发送 OTP 中...' : loading ? '验证中...' : '下一步'}
            </button>
          </form>
        ) : (
          // OTP 验证表单
          <form onSubmit={handleVerifyOtp} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>
                OTP 验证码 <span style={styles.required}>*</span>
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ''));
                  if (error) setError('');
                }}
                placeholder="请输入6位验证码"
                style={styles.input}
                disabled={loading}
                maxLength="6"
                autoComplete="one-time-code"
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
              {loading ? '验证中...' : '验证并登录'}
            </button>

            <div style={styles.otpActions}>
              <button
                type="button"
                onClick={handleResendOtp}
                style={styles.resendButton}
                disabled={sendingOtp}
              >
                {sendingOtp ? '发送中...' : '重新发送 OTP'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowOtpInput(false);
                  setOtpCode('');
                  setSessionId('');
                  setError('');
                }}
                style={styles.backButton}
              >
                返回
              </button>
            </div>
          </form>
        )}

        {/* 底部说明 */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            💡 <strong>提示：</strong>这是管理员专用登录入口
          </p>
          <p style={styles.footerText}>
            如需作为参与者（Seller/Customer）登录，请使用
            <a 
              href={`/login/${orgCode}-${eventCode}`}
              style={styles.link}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/login/${orgCode}-${eventCode}`);
              }}
            >
              普通登录入口
            </a>
          </p>
        </div>
      </div>

      {/* 装饰背景 */}
      <div style={styles.backgroundDecoration}>
        <div style={styles.circle1}></div>
        <div style={styles.circle2}></div>
        <div style={styles.circle3}></div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '2rem',
    position: 'relative',
    overflow: 'hidden'
  },
  loginBox: {
    background: 'white',
    borderRadius: '20px',
    padding: '3rem',
    maxWidth: '480px',
    width: '100%',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    position: 'relative',
    zIndex: 1
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  logo: {
    marginBottom: '1rem'
  },
  logoIcon: {
    fontSize: '4rem',
    display: 'inline-block'
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
  infoBox: {
    background: '#e0f2fe',
    border: '1px solid #0284c7',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '2rem',
    color: '#075985'
  },
  eventInfo: {
    marginTop: '0.75rem'
  },
  eventInfoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 0',
    borderBottom: '1px solid #bae6fd'
  },
  label: {
    fontSize: '0.875rem',
    color: '#0c4a6e'
  },
  value: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#0369a1'
  },
  errorBox: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '2rem',
    textAlign: 'center',
    color: '#991b1b'
  },
  errorText: {
    marginTop: '1rem',
    fontSize: '0.875rem',
    lineHeight: '1.5'
  },
  form: {
    marginBottom: '1.5rem'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  formLabel: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  required: {
    color: '#ef4444'
  },
  input: {
    width: '100%',
    padding: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'all 0.3s',
    boxSizing: 'border-box'
  },
  errorMessage: {
    padding: '1rem',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '10px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  submitButton: {
    width: '100%',
    padding: '1rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '1.1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)'
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  otpNotice: {
    background: '#f0fdf4',
    border: '1px solid #86efac',
    borderRadius: '10px',
    padding: '1rem',
    marginBottom: '1.5rem'
  },
  otpNoticeText: {
    fontSize: '0.875rem',
    color: '#166534',
    margin: 0,
    lineHeight: '1.5'
  },
  otpActions: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem'
  },
  resendButton: {
    flex: 1,
    padding: '0.75rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    fontWeight: '500'
  },
  backButton: {
    flex: 1,
    padding: '0.75rem',
    background: 'white',
    color: '#6b7280',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer'
  },
  footer: {
    textAlign: 'center',
    paddingTop: '1.5rem',
    borderTop: '1px solid #e5e7eb'
  },
  footerText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0.5rem 0'
  },
  link: {
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: '600',
    marginLeft: '0.25rem',
    cursor: 'pointer'
  },
  backgroundDecoration: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    overflow: 'hidden'
  },
  circle1: {
    position: 'absolute',
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
    top: '-150px',
    left: '-150px'
  },
  circle2: {
    position: 'absolute',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
    bottom: '-200px',
    right: '-200px'
  },
  circle3: {
    position: 'absolute',
    width: '200px',
    height: '200px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
    top: '50%',
    right: '10%'
  }
};

export default EventManagerLogin;

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

/**
 * Event Manager 專用登錄頁面
 * 
 * @route /event-manager/:orgEventCode/login
 * @example /event-manager/fch-2025/login
 * 
 * @description
 * 1. 從 URL 獲取 orgEventCode (格式: orgCode-eventCode)
 * 2. Event Manager 輸入手機號和密碼進行驗證
 * 3. 驗證通過後發送 SMS OTP 到手機
 * 4. 輸入 OTP 驗證成功後自動跳轉到 Event Manager Dashboard
 * 
 * @architecture
 * - Event Manager 存儲在: organizations/{orgId}/events/{eventId}/eventManager (物件)
 * - 不在 users 集合中
 */
const EventManagerLogin = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams(); // 例如: "fch-2025"
  
  // 解析 orgEventCode
  const [orgCode, eventCode] = orgEventCode?.split('-') || ['', ''];
  const isValidOrgEventCode = !!orgCode && !!eventCode;
  
  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [eventManagerData, setEventManagerData] = useState(null);
  
  // SMS OTP 相關狀態
  const [otpStep, setOtpStep] = useState(false); // false: 密碼登錄, true: OTP 驗證
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0); // OTP 倒計時

  // OTP 倒計時
  useEffect(() => {
    if (otpTimer <= 0) return;
    const timer = setTimeout(() => setOtpTimer((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [otpTimer]);

  /**
   * 發送 OTP
   */
  const sendOtp = async (phoneNumber) => {
    try {
      console.log('[EventManagerLogin] 發送 OTP 到:', phoneNumber);
      
      const resp = await fetch('/api/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phoneNumber, 
          orgCode, 
          eventCode,
          loginType: 'eventManager' // ✅ 標記為 Event Manager 專用登錄
        })
      });

      const data = await resp.json();
      
      if (!resp.ok || !data.success) {
        throw new Error(data.error?.message || 'OTP 發送失敗');
      }

      console.log('[EventManagerLogin] OTP 發送成功');
      setOtpTimer(120); // 2分鐘倒計時
      
    } catch (err) {
      console.error('[EventManagerLogin] OTP 發送錯誤:', err);
      throw err;
    }
  };

  /**
   * 處理密碼登錄提交 - 第一步
   */
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!isValidOrgEventCode) {
      setError('無效的活動連結，請檢查網址是否正確');
      return;
    }
    
    setLoading(true);

    try {
      console.log('[EventManagerLogin] 密碼驗證請求:', { 
        orgCode, 
        eventCode, 
        phoneNumber: formData.phoneNumber 
      });

      // 調用 Event Manager 專用登錄端點
      const url = '/api/eventManagerLoginHttp';
      
      const payload = {
        orgCode: orgCode.toLowerCase(),
        eventCode: eventCode,
        phoneNumber: formData.phoneNumber,
        password: formData.password
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data = null;
      
      try {
        data = text ? JSON.parse(text) : null;
      } catch (parseError) {
        console.warn('[EventManagerLogin] 非 JSON 響應, status:', resp.status);
        if (resp.ok) {
          throw new Error('伺服器回傳非 JSON，請稍後重試或聯絡管理員');
        }
        throw new Error(`HTTP ${resp.status}: ${text?.substring(0, 200) || '非 JSON 響應'}`);
      }

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || `請求失敗 (HTTP ${resp.status})`);
      }

      console.log('[EventManagerLogin] 密碼驗證成功');

      // 保存 Event Manager 數據和 Custom Token
      const eventManagerInfo = {
        phoneNumber: formData.phoneNumber,
        orgCode,
        eventCode,
        orgEventCode,
        customToken: data.customToken,
        organizationId: data.organizationId,
        eventId: data.eventId
      };
      
      setEventManagerData(eventManagerInfo);

      // 發送 OTP
      await sendOtp(formData.phoneNumber);

      // 切換到 OTP 驗證步驟
      setOtpStep(true);
      setOtp('');

    } catch (err) {
      console.error('[EventManagerLogin] 錯誤:', err);
      const msg = err?.message || '登錄失敗，請重試';
      
      if (/組織|活動|not[- ]?found/i.test(msg)) {
        setError('找不到該組織或活動');
      } else if (/手機號|密碼|不正確|incorrect|invalid/i.test(msg)) {
        setError('手機號或密碼不正確');
      } else if (/OTP|驗證碼/i.test(msg)) {
        setError('驗證碼發送失敗，請重試');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * 處理 OTP 驗證提交 - 第二步
   */
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (otp.length !== 6) {
      setError('請輸入 6 位驗證碼');
      return;
    }
    
    setOtpLoading(true);

    try {
      console.log('[EventManagerLogin] OTP 驗證請求');

      // 驗證 OTP
      const verifyResp = await fetch('/api/verifyOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: eventManagerData.phoneNumber,
          otp: otp,
          orgCode: eventManagerData.orgCode,
          eventCode: eventManagerData.eventCode
        })
      });

      const verifyData = await verifyResp.json();
      
      if (!verifyResp.ok || !verifyData.success) {
        throw new Error(verifyData.error?.message || 'OTP 驗證失敗');
      }

      console.log('[EventManagerLogin] OTP 驗證成功');

      // 使用 Custom Token 登錄 Firebase Auth
      const userCredential = await signInWithCustomToken(auth, eventManagerData.customToken);
      console.log('[EventManagerLogin] Firebase Auth 登錄成功:', userCredential.user.uid);

      // 保存 Event Manager 信息到 localStorage（Dashboard 需要）
      localStorage.setItem('eventManagerInfo', JSON.stringify(eventManagerData));
      console.log('[EventManagerLogin] 已保存 eventManagerInfo 到 localStorage');

      // 跳轉到 Event Manager Dashboard
      const dashboardPath = `/event-manager/${eventManagerData.orgEventCode}/dashboard`;
      console.log('[EventManagerLogin] 跳轉到:', dashboardPath);
      navigate(dashboardPath);

    } catch (err) {
      console.error('[EventManagerLogin] OTP 驗證錯誤:', err);
      const msg = err?.message || 'OTP 驗證失敗';
      
      if (/過期|expired/i.test(msg)) {
        setError('驗證碼已過期，請重新發送');
      } else if (/錯誤|incorrect|invalid/i.test(msg)) {
        setError('驗證碼不正確，請重試');
      } else {
        setError(msg);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  /**
   * 重新發送 OTP
   */
  const handleResendOtp = async () => {
    try {
      await sendOtp(eventManagerData.phoneNumber);
      setError('');
      console.log('[EventManagerLogin] 驗證碼已重新發送');
    } catch (err) {
      setError('驗證碼發送失敗，請重試');
    }
  };

  /**
   * 返回密碼輸入界面
   */
  const handleBackToPassword = () => {
    setOtpStep(false);
    setOtp('');
    setError('');
    setEventManagerData(null);
  };

  // OTP 畫面
  if (otpStep) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.header}>
            <div style={styles.logo}>📱</div>
            <h1 style={styles.title}>短信驗證</h1>
            <p style={styles.subtitle}>驗證碼已發送到 {eventManagerData?.phoneNumber}</p>
            {isValidOrgEventCode && (
              <div style={styles.eventBadge}>
                <span style={styles.eventBadgeIcon}>🏷️</span>
                <span>{orgCode.toUpperCase()}-{eventCode}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleOtpSubmit} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>驗證碼 (6位數字) *</label>
              <input
                type="text"
                maxLength="6"
                style={styles.otpInput}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
              />
              <small style={styles.hint}>請輸入收到的 6 位驗證碼</small>
            </div>

            {error && (
              <div style={styles.errorBox}>⚠️ {error}</div>
            )}

            <button
              type="submit"
              style={{
                ...styles.submitButton,
                opacity: otpLoading ? 0.6 : 1,
                cursor: otpLoading ? 'not-allowed' : 'pointer'
              }}
              disabled={otpLoading}
            >
              {otpLoading ? '驗證中...' : '確認驗證'}
            </button>

            {otpTimer <= 0 ? (
              <button 
                type="button" 
                style={styles.resendButton} 
                onClick={handleResendOtp}
              >
                重新發送驗證碼
              </button>
            ) : (
              <div style={styles.timerInfo}>
                重新發送倒數: {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')}
              </div>
            )}
          </form>

          <button 
            style={styles.backToLoginButton} 
            onClick={handleBackToPassword}
          >
            ← 返回登入
          </button>
        </div>
      </div>
    );
  }

  // 密碼畫面
  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        <div style={styles.header}>
          <div style={styles.logo}>🎪</div>
          <h1 style={styles.title}>活動主任登入</h1>
          <p style={styles.subtitle}>Event Manager Login</p>
          {isValidOrgEventCode && (
            <div style={styles.eventBadge}>
              <span style={styles.eventBadgeIcon}>🏷️</span>
              <span>{orgCode.toUpperCase()}-{eventCode}</span>
            </div>
          )}
        </div>

        {!isValidOrgEventCode && (
          <div style={styles.errorBox}>
            ⚠️ 無效的活動連結
            <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
              正確格式: /event-manager/組織碼-活動碼/login（例如: /event-manager/fch-2025/login）
            </div>
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>手機號 *</label>
            <input
              type="tel"
              style={styles.input}
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              placeholder="60123456789"
              required
              disabled={!isValidOrgEventCode}
            />
            <small style={styles.hint}>馬來西亞手機號（含國碼 60）</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>密碼 *</label>
            <input
              type="password"
              style={styles.input}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              required
              disabled={!isValidOrgEventCode}
            />
          </div>

          {error && (
            <div style={styles.errorBox}>⚠️ {error}</div>
          )}

          <button
            type="submit"
            style={{
              ...styles.submitButton,
              opacity: loading || !isValidOrgEventCode ? 0.6 : 1,
              cursor: loading || !isValidOrgEventCode ? 'not-allowed' : 'pointer'
            }}
            disabled={loading || !isValidOrgEventCode}
          >
            {loading ? '驗證中...' : '下一步'}
          </button>
        </form>

        <div style={styles.footer}>
          <p style={styles.helpText}>忘記密碼？請聯絡平台管理員</p>
          <p style={styles.helpText}>沒有登入連結？請向平台管理員索取</p>
        </div>
      </div>
    </div>
  );
};

// 樣式定義（與 UniversalLogin 一致）
const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '1rem'
  },
  loginCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
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
    margin: '0 0 1rem 0'
  },
  eventBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#f3f4f6',
    padding: '0.5rem 1rem',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginTop: '1rem'
  },
  eventBadgeIcon: {
    fontSize: '1.25rem'
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
    transition: 'border-color 0.2s'
  },
  otpInput: {
    padding: '1.5rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '2rem',
    textAlign: 'center',
    letterSpacing: '0.5rem',
    fontFamily: 'monospace',
    outline: 'none',
    transition: 'border-color 0.2s'
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
    marginTop: '1rem',
    transition: 'all 0.2s'
  },
  footer: {
    marginTop: '2rem',
    textAlign: 'center'
  },
  helpText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0.5rem 0'
  },
  backToLoginButton: {
    width: '100%',
    padding: '0.75rem',
    background: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    marginTop: '1rem'
  },
  resendButton: {
    width: '100%',
    padding: '0.75rem',
    marginTop: '1rem',
    background: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  timerInfo: {
    width: '100%',
    textAlign: 'center',
    marginTop: '1rem',
    padding: '0.75rem',
    background: '#f0f4ff',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#667eea'
  }
};

export default EventManagerLogin;
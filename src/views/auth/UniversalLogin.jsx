import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

/**
 * 统一登录页面 - 支持所有角色 + SMS OTP 验证
 * 
 * @route /login/:orgEventCode
 * @example /login/fch-2025
 * 
 * @description
 * 1. 从 URL 获取 orgEventCode (格式: orgCode-eventCode)
 * 2. 用户输入手机号和密码，进行初始验证
 * 3. 验证通过后，系统发送 OTP 验证码到手机
 * 4. 用户输入 OTP，验证成功后根据角色自动跳转到对应的 Dashboard
 * 5. 支持多角色用户选择进入哪个角色
 */
const UniversalLogin = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams(); // 例如: "fch-2025"
  
  // 解析 orgEventCode
  const [orgCode, eventCode] = orgEventCode?.split('-') || ['', ''];
  
  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const [userRoles, setUserRoles] = useState([]);
  const [userData, setUserData] = useState(null);
  
  // SMS OTP 相关状态
  const [otpStep, setOtpStep] = useState(false); // false: 密码登录, true: OTP 验证
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0); // OTP 倒计时

  // 验证 orgEventCode 格式
  const isValidOrgEventCode = orgCode && eventCode;

  /**
   * 处理密码登录提交 - 第一步
   */
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!isValidOrgEventCode) {
      setError('无效的活动链接，请检查网址是否正确');
      return;
    }
    
    setLoading(true);

    try {
      console.log('[UniversalLogin] 密码验证请求:', { 
        orgCode, 
        eventCode, 
        phoneNumber: formData.phoneNumber 
      });

      const url = '/api/loginUniversalHttp'; // 通用登录端点
      
      const payload = {
        orgCode: orgCode.toLowerCase(),
        eventCode: eventCode,
        phoneNumber: formData.phoneNumber,
        password: formData.password
      };

      const startTime = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data = null;
      
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        console.warn('[UniversalLogin] 非 JSON 响应, status:', resp.status);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${text?.substring(0, 200) || '非 JSON 响应'}`);
        }
      }
      
      if (!resp.ok || !data?.success) {
        const serverMsg = data?.error?.message;
        throw new Error(serverMsg || `请求失败 (HTTP ${resp.status})`);
      }

      console.log('[UniversalLogin] 密码验证成功:', data, '耗时:', Date.now() - startTime, 'ms');

      // 密码验证通过，保存临时信息并发送 OTP
      const tempUserData = {
        userId: data.userId,
        organizationId: data.organizationId,
        eventId: data.eventId,
        orgCode: orgCode,
        eventCode: eventCode,
        orgEventCode: orgEventCode,
        englishName: data.englishName,
        chineseName: data.chineseName,
        roles: Array.isArray(data.roles)
          ? data.roles.map(r => r === 'event_manager' ? 'eventManager' : r)
          : [],
        phoneNumber: formData.phoneNumber,
        customToken: data.customToken
      };

      setUserData(tempUserData);
      
      // 发送 OTP
      await sendOtp(formData.phoneNumber);
      
      // 切换到 OTP 输入界面
      setOtpStep(true);
      setOtp('');
      
    } catch (error) {
      console.error('[UniversalLogin] 错误:', error);
      const msg = error?.message || '登录失败，请重试';
      
      // 简化错误信息映射
      if (/组织|活动|not[- ]?found/i.test(msg)) {
        setError('找不到该组织或活动');
      } else if (/密码|permission[- ]?denied/i.test(msg)) {
        setError('手机号或密码错误');
      } else if (/必填|invalid[- ]?argument/i.test(msg)) {
        setError('请填写所有必填字段');
      } else if (/角色/i.test(msg)) {
        setError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * 发送 OTP 到手机
   */
  const sendOtp = async (phoneNumber) => {
    try {
      console.log('[UniversalLogin] 发送 OTP 到:', phoneNumber);
      
      const url = '/api/sendOtp';
      const payload = {
        phoneNumber: phoneNumber,
        orgCode: orgCode.toLowerCase(),
        eventCode: eventCode
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
      } catch (_) {
        console.warn('[UniversalLogin] 发送 OTP 响应非 JSON');
      }

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || `发送 OTP 失败 (HTTP ${resp.status})`);
      }

      console.log('[UniversalLogin] OTP 已发送');
      setOtpTimer(300); // 5分钟倒计时
      startOtpTimer();
      
    } catch (error) {
      console.error('[UniversalLogin] 发送 OTP 错误:', error);
      throw new Error('发送验证码失败，请重试');
    }
  };

  /**
   * OTP 倒计时
   */
  const startOtpTimer = () => {
    const interval = setInterval(() => {
      setOtpTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /**
   * 验证 OTP - 第二步
   */
  const handleOtpVerify = async (e) => {
    e.preventDefault();
    setError('');

    if (!otp || otp.length !== 6) {
      setError('请输入6位验证码');
      return;
    }

    setOtpLoading(true);

    try {
      console.log('[UniversalLogin] 验证 OTP');

      const url = '/api/verifyOtp';
      const payload = {
        phoneNumber: formData.phoneNumber,
        otp: otp,
        orgCode: orgCode.toLowerCase(),
        eventCode: eventCode
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
      } catch (_) {
        console.warn('[UniversalLogin] 验证 OTP 响应非 JSON');
      }

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || `OTP 验证失败 (HTTP ${resp.status})`);
      }

      console.log('[UniversalLogin] OTP 验证成功');

      // ✅ OTP 验证通过，使用 Custom Token 登录 Firebase Auth
      if (userData?.customToken) {
        await signInWithCustomToken(auth, userData.customToken);

        const baseInfo = {
          ...userData,
          loginTime: new Date().toISOString()
        };

        // 🎯 处理角色跳转
        if (userData.roles.length === 1) {
          // 只有一个角色，直接跳转
          handleRoleNavigation(userData.roles[0], baseInfo);
        } else if (userData.roles.length > 1) {
          // 多个角色，显示选择界面
          setUserRoles(userData.roles);
          setShowRoleSelection(true);
        } else {
          throw new Error('用户没有分配任何角色，请联系管理员');
        }
      }
    } catch (error) {
      console.error('[UniversalLogin] OTP 验证错误:', error);
      const msg = error?.message || 'OTP 验证失败，请重试';
      setError(msg);
    } finally {
      setOtpLoading(false);
    }
  };

  /**
   * 返回密码登录
   */
  const handleBackToPassword = () => {
    setOtpStep(false);
    setOtp('');
    setError('');
    setOtpTimer(0);
    setUserData(null);
  };

  /**
   * 处理角色选择后的跳转
   */
  const handleRoleSelection = (selectedRole) => {
    if (userData) {
      handleRoleNavigation(selectedRole, userData);
    }
  };

  /**
   * 根据角色跳转到对应的 Dashboard
   */
  const handleRoleNavigation = (role, userInfo) => {
    // 角色到路由的映射（统一使用驼峰式）
    const roleRoutes = {
      'platformAdmin': '/platform-admin/dashboard',
      'eventManager': `/event-manager/${orgEventCode}/dashboard`,
      'sellerManager': `/seller-manager/${orgEventCode}/dashboard`,
      'merchantManager': `/merchant-manager/${orgEventCode}/dashboard`,
      'customerManager': `/customer-manager/${orgEventCode}/dashboard`,
      'seller': `/seller/${orgEventCode}/dashboard`,
      'merchant': `/merchant/${orgEventCode}/dashboard`,
      'customer': `/customer/${orgEventCode}/dashboard`
    };

    // localStorage key 映射
    const storageKeys = {
      'platformAdmin': 'platformAdminInfo',
      'eventManager': 'eventManagerInfo',
      'sellerManager': 'sellerManagerInfo',
      'merchantManager': 'merchantManagerInfo',
      'customerManager': 'customerManagerInfo',
      'seller': 'sellerInfo',
      'merchant': 'merchantInfo',
      'customer': 'customerInfo'
    };

    // 保存当前角色信息到 localStorage
    const storageKey = storageKeys[role];
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify({
        ...userInfo,
        currentRole: role
      }));
    }

    // 跳转到对应的 Dashboard
    const route = roleRoutes[role];
    if (route) {
      console.log('[UniversalLogin] 跳转到:', route, '角色:', role);
      navigate(route);
    } else {
      setError(`未知角色: ${role}`);
    }
  };

  // 角色显示配置（驼峰式）
  const roleConfig = {
    'platformAdmin': { label: 'Platform Admin', icon: '🔧', color: '#ef4444' },
    'eventManager': { label: 'Event Manager', icon: '🎯', color: '#667eea' },
    'sellerManager': { label: 'Seller Manager', icon: '💰', color: '#f59e0b' },
    'merchantManager': { label: 'Merchant Manager', icon: '🏪', color: '#8b5cf6' },
    'customerManager': { label: 'Customer Manager', icon: '🎫', color: '#10b981' },
    'seller': { label: 'Seller (销售员)', icon: '🛍️', color: '#06b6d4' },
    'merchant': { label: 'Merchant (商家)', icon: '🏬', color: '#84cc16' },
    'customer': { label: 'Customer (顾客)', icon: '👤', color: '#ec4899' }
  };

  // 如果显示角色选择界面
  if (showRoleSelection) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.header}>
            <div style={styles.logo}>🎭</div>
            <h1 style={styles.title}>选择身份</h1>
            <p style={styles.subtitle}>您有多个身份，请选择要使用的身份</p>
          </div>

          <div style={styles.roleGrid}>
            {userRoles.map(role => {
              const config = roleConfig[role] || { label: role, icon: '👤', color: '#6b7280' };
              return (
                <div
                  key={role}
                  style={{
                    ...styles.roleCard,
                    borderColor: config.color
                  }}
                  onClick={() => handleRoleSelection(role)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = `0 8px 16px ${config.color}40`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                >
                  <div style={{ ...styles.roleIcon, color: config.color }}>
                    {config.icon}
                  </div>
                  <div style={styles.roleLabel}>{config.label}</div>
                </div>
              );
            })}
          </div>

          <button
            style={styles.backToLoginButton}
            onClick={() => {
              setShowRoleSelection(false);
              setUserRoles([]);
              setUserData(null);
              setOtpStep(false);
            }}
          >
            ← 返回登录
          </button>
        </div>
      </div>
    );
  }

  // OTP 验证界面
  if (otpStep) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.header}>
            <div style={styles.logo}>📱</div>
            <h1 style={styles.title}>短信验证</h1>
            <p style={styles.subtitle}>验证码已发送到 {formData.phoneNumber}</p>
          </div>

          <form onSubmit={handleOtpVerify} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>验证码 (6位数字) *</label>
              <input
                type="text"
                maxLength="6"
                style={styles.otpInput}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
              />
              <small style={styles.hint}>请输入收到的6位验证码</small>
            </div>

            {/* 错误提示 */}
            {error && (
              <div style={styles.errorBox}>
                ⚠️ {error}
              </div>
            )}

            {/* OTP 验证按钮 */}
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                opacity: otpLoading ? 0.6 : 1,
                cursor: otpLoading ? 'not-allowed' : 'pointer'
              }}
              disabled={otpLoading}
            >
              {otpLoading ? '验证中...' : '确认验证'}
            </button>

            {/* 重新发送按钮 */}
            {otpTimer <= 0 ? (
              <button
                type="button"
                style={styles.resendButton}
                onClick={async () => {
                  try {
                    await sendOtp(formData.phoneNumber);
                    setOtp('');
                    setError('');
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                重新发送验证码
              </button>
            ) : (
              <div style={styles.timerInfo}>
                重新发送倒计时: {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')}
              </div>
            )}
          </form>

          {/* 返回登录按钮 */}
          <button
            style={styles.backToLoginButton}
            onClick={handleBackToPassword}
          >
            ← 返回登录
          </button>
        </div>
      </div>
    );
  }

  // 正常登录界面
  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        {/* Logo 和标题 */}
        <div style={styles.header}>
          <div style={styles.logo}>🎪</div>
          <h1 style={styles.title}>MyBazaar 登录</h1>
          <p style={styles.subtitle}>义卖会管理系统</p>
          {isValidOrgEventCode && (
            <div style={styles.eventBadge}>
              <span style={styles.eventBadgeIcon}>🏷️</span>
              <span>{orgCode.toUpperCase()}-{eventCode}</span>
            </div>
          )}
        </div>

        {/* 无效链接提示 */}
        {!isValidOrgEventCode && (
          <div style={styles.errorBox}>
            ⚠️ 无效的活动链接
            <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
              正确格式: /login/组织代码-活动代码 (例如: /login/fch-2025)
            </div>
          </div>
        )}

        {/* 登录表单 */}
        <form onSubmit={handlePasswordSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>手机号 *</label>
            <input
              type="tel"
              style={styles.input}
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              placeholder="60123456789"
              required
              disabled={!isValidOrgEventCode}
            />
            <small style={styles.hint}>马来西亚手机号（含国家代码60）</small>
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
              disabled={!isValidOrgEventCode}
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
              opacity: loading || !isValidOrgEventCode ? 0.6 : 1,
              cursor: loading || !isValidOrgEventCode ? 'not-allowed' : 'pointer'
            }}
            disabled={loading || !isValidOrgEventCode}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {/* 帮助信息 */}
        <div style={styles.footer}>
          <p style={styles.helpText}>
            忘记密码？请联系活动管理员
          </p>
          <p style={styles.helpText}>
            没有登录链接？请向活动负责人索取
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
  // 角色选择样式
  roleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem',
    marginBottom: '2rem'
  },
  roleCard: {
    padding: '1.5rem',
    border: '2px solid',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'center',
    background: 'white'
  },
  roleIcon: {
    fontSize: '3rem',
    marginBottom: '0.5rem'
  },
  roleLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
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
    cursor: 'pointer'
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

export default UniversalLogin;
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

/**
 * 统一登录页面 - 支持所有角色
 * 
 * @route /login/:orgEventCode
 * @example /login/fch-2025
 * 
 * @description
 * 1. 从 URL 获取 orgEventCode (格式: orgCode-eventCode)
 * 2. 用户只需输入手机号和密码
 * 3. 登录成功后根据角色自动跳转到对应的 Dashboard
 * 4. 支持多角色用户选择进入哪个角色
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

  // 验证 orgEventCode 格式
  const isValidOrgEventCode = orgCode && eventCode;

  /**
   * 处理登录提交
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!isValidOrgEventCode) {
      setError('无效的活动链接，请检查网址是否正确');
      return;
    }
    
    setLoading(true);

    try {
      console.log('[UniversalLogin] 登录请求:', { 
        orgCode, 
        eventCode, 
        phoneNumber: formData.phoneNumber 
      });

      const url = '/api/loginUniversalHttp'; // 🆕 新的通用登录端点
      
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

      console.log('[UniversalLogin] 登录成功:', data, '耗时:', Date.now() - startTime, 'ms');

      // ✅ 使用 Custom Token 登录 Firebase Auth
      if (data.customToken) {
        await signInWithCustomToken(auth, data.customToken);

        // 保存基本信息
        const baseInfo = {
          userId: data.userId,
          organizationId: data.organizationId,
          eventId: data.eventId,
          orgCode: orgCode,
          eventCode: eventCode,
          orgEventCode: orgEventCode,
          englishName: data.englishName,
          chineseName: data.chineseName,
          roles: data.roles, // ['event_manager', 'seller_manager']
          loginTime: new Date().toISOString()
        };

        // 🎯 处理角色跳转
        if (data.roles.length === 1) {
          // 只有一个角色，直接跳转
          handleRoleNavigation(data.roles[0], baseInfo);
        } else if (data.roles.length > 1) {
          // 多个角色，显示选择界面
          setUserData(baseInfo);
          setUserRoles(data.roles);
          setShowRoleSelection(true);
        } else {
          throw new Error('用户没有分配任何角色，请联系管理员');
        }
      }
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
    // 角色到路由的映射
    const roleRoutes = {
      'platform_admin': '/platform-admin/dashboard',
      'event_manager': `/event-manager/${orgEventCode}/dashboard`,
      'seller_manager': `/seller-manager/${orgEventCode}/dashboard`,
      'merchant_manager': `/merchant-manager/${orgEventCode}/dashboard`,
      'customer_manager': `/customer-manager/${orgEventCode}/dashboard`,
      'seller': `/seller/${orgEventCode}/dashboard`,
      'merchant': `/merchant/${orgEventCode}/dashboard`,
      'customer': `/customer/${orgEventCode}/dashboard`
    };

    // localStorage key 映射
    const storageKeys = {
      'platform_admin': 'platformAdminInfo',
      'event_manager': 'eventManagerInfo',
      'seller_manager': 'sellerManagerInfo',
      'merchant_manager': 'merchantManagerInfo',
      'customer_manager': 'customerManagerInfo',
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

  // 角色显示配置
  const roleConfig = {
    'platform_admin': { label: 'Platform Admin', icon: '🔧', color: '#ef4444' },
    'event_manager': { label: 'Event Manager', icon: '🎯', color: '#667eea' },
    'seller_manager': { label: 'Seller Manager', icon: '💰', color: '#f59e0b' },
    'merchant_manager': { label: 'Merchant Manager', icon: '🏪', color: '#8b5cf6' },
    'customer_manager': { label: 'Customer Manager', icon: '🎫', color: '#10b981' },
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
            }}
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
        <form onSubmit={handleSubmit} style={styles.form}>
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
  }
};

export default UniversalLogin;

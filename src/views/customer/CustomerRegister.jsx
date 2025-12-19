import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';

/**
 * Customer注册页面
 * 
 * URL参数：
 * - orgId: 组织ID
 * - eventId: 活动ID
 * 
 * 路由示例：
 * /customer/register?orgId=xxx&eventId=yyy
 */
const CustomerRegister = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const organizationId = searchParams.get('orgId');
  const eventId = searchParams.get('eventId');

  const [formData, setFormData] = useState({
    phoneNumber: '',
    displayName: '',
    password: '',
    confirmPassword: '',
    email: ''
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // 验证手机号
  const validatePhone = (phone) => {
    // 马来西亚手机号：+60或60开头，9-10位数字
    const phoneRegex = /^(\+?60|0)?1\d{8,9}$/;
    return phoneRegex.test(phone.replace(/[\s\-]/g, ''));
  };

  // 格式化手机号为+60格式
  const formatPhoneNumber = (phone) => {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    if (cleaned.startsWith('+60')) {
      return cleaned;
    } else if (cleaned.startsWith('60')) {
      return '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
      return '+60' + cleaned.substring(1);
    } else if (cleaned.startsWith('1')) {
      return '+60' + cleaned;
    }
    
    return '+60' + cleaned;
  };

  // 处理输入变化
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // 清除该字段的错误
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  // 验证表单
  const validateForm = () => {
    const newErrors = {};

    // 手机号验证
    if (!formData.phoneNumber) {
      newErrors.phoneNumber = '请输入手机号';
    } else if (!validatePhone(formData.phoneNumber)) {
      newErrors.phoneNumber = '手机号格式不正确';
    }

    // 昵称验证
    if (!formData.displayName) {
      newErrors.displayName = '请输入昵称';
    } else if (formData.displayName.length < 2) {
      newErrors.displayName = '昵称至少2个字符';
    } else if (formData.displayName.length > 20) {
      newErrors.displayName = '昵称不能超过20个字符';
    }

    // 密码验证
    if (!formData.password) {
      newErrors.password = '请输入密码';
    } else if (formData.password.length < 6) {
      newErrors.password = '密码至少6个字符';
    }

    // 确认密码验证
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = '请确认密码';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = '两次输入的密码不一致';
    }

    // 邮箱验证（可选）
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = '邮箱格式不正确';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 处理注册
  const handleRegister = async (e) => {
    e.preventDefault();

    // 验证组织和活动ID
    if (!organizationId || !eventId) {
      alert('缺少必要的参数，请从正确的链接访问注册页面');
      return;
    }

    // 验证表单
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const createCustomer = httpsCallable(functions, 'createCustomer');
      
      const result = await createCustomer({
        organizationId,
        eventId,
        phoneNumber: formatPhoneNumber(formData.phoneNumber),
        displayName: formData.displayName.trim(),
        password: formData.password,
        email: formData.email.trim() || null
      });

      console.log('[CustomerRegister] 注册成功:', result.data);

      // 显示成功消息
      alert('注册成功！即将跳转到登录页面');

      // 跳转到登录页面
      navigate(`/universal-login?orgId=${organizationId}&eventId=${eventId}&mode=customer`);

    } catch (error) {
      console.error('[CustomerRegister] 注册失败:', error);
      
      let errorMessage = '注册失败，请重试';
      
      if (error.code === 'already-exists') {
        errorMessage = '该手机号已注册，请直接登录';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 跳转到登录页面
  const handleGoToLogin = () => {
    navigate(`/universal-login?orgId=${organizationId}&eventId=${eventId}&mode=customer`);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo和标题 */}
        <div style={styles.header}>
          <div style={styles.logo}>🎪</div>
          <h1 style={styles.title}>MyBazaar</h1>
          <h2 style={styles.subtitle}>Customer会员注册</h2>
        </div>

        {/* 注册表单 */}
        <form onSubmit={handleRegister} style={styles.form}>
          {/* 手机号 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              手机号 <span style={styles.required}>*</span>
            </label>
            <input
              type="tel"
              name="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleChange}
              placeholder="例：0123456789 或 +60123456789"
              style={{
                ...styles.input,
                ...(errors.phoneNumber ? styles.inputError : {})
              }}
              disabled={loading}
            />
            {errors.phoneNumber && (
              <p style={styles.errorText}>{errors.phoneNumber}</p>
            )}
            <p style={styles.hint}>马来西亚手机号，用于登录和接收通知</p>
          </div>

          {/* 昵称 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              昵称 <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              name="displayName"
              value={formData.displayName}
              onChange={handleChange}
              placeholder="请输入您的昵称"
              style={{
                ...styles.input,
                ...(errors.displayName ? styles.inputError : {})
              }}
              disabled={loading}
            />
            {errors.displayName && (
              <p style={styles.errorText}>{errors.displayName}</p>
            )}
            <p style={styles.hint}>2-20个字符，将显示给其他用户</p>
          </div>

          {/* 密码 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              密码 <span style={styles.required}>*</span>
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="请输入密码"
              style={{
                ...styles.input,
                ...(errors.password ? styles.inputError : {})
              }}
              disabled={loading}
            />
            {errors.password && (
              <p style={styles.errorText}>{errors.password}</p>
            )}
            <p style={styles.hint}>至少6个字符</p>
          </div>

          {/* 确认密码 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              确认密码 <span style={styles.required}>*</span>
            </label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="请再次输入密码"
              style={{
                ...styles.input,
                ...(errors.confirmPassword ? styles.inputError : {})
              }}
              disabled={loading}
            />
            {errors.confirmPassword && (
              <p style={styles.errorText}>{errors.confirmPassword}</p>
            )}
          </div>

          {/* 邮箱（可选） */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              邮箱（可选）
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="example@email.com"
              style={{
                ...styles.input,
                ...(errors.email ? styles.inputError : {})
              }}
              disabled={loading}
            />
            {errors.email && (
              <p style={styles.errorText}>{errors.email}</p>
            )}
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.submitButton,
              ...(loading ? styles.buttonDisabled : {})
            }}
          >
            {loading ? (
              <>
                <span style={styles.spinner}></span>
                注册中...
              </>
            ) : (
              '注册'
            )}
          </button>
        </form>

        {/* 登录链接 */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            已有账号？
            <button
              onClick={handleGoToLogin}
              disabled={loading}
              style={styles.linkButton}
            >
              立即登录
            </button>
          </p>
        </div>

        {/* 使用条款 */}
        <div style={styles.terms}>
          <p style={styles.termsText}>
            注册即表示您同意MyBazaar的
            <a href="/terms" style={styles.link}>使用条款</a>
            和
            <a href="/privacy" style={styles.link}>隐私政策</a>
          </p>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '2rem 1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  card: {
    width: '100%',
    maxWidth: '450px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  logo: {
    fontSize: '3rem',
    marginBottom: '0.5rem'
  },
  title: {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: '#2196F3',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '1.1rem',
    fontWeight: '500',
    color: '#666',
    margin: 0
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#333'
  },
  required: {
    color: '#f44336'
  },
  input: {
    padding: '0.75rem 1rem',
    fontSize: '1rem',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    transition: 'all 0.2s'
  },
  inputError: {
    borderColor: '#f44336'
  },
  errorText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#f44336'
  },
  hint: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#999'
  },
  submitButton: {
    marginTop: '0.5rem',
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '600',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  spinner: {
    width: '16px',
    height: '16px',
    border: '2px solid #fff',
    borderTop: '2px solid transparent',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  footer: {
    marginTop: '1.5rem',
    textAlign: 'center'
  },
  footerText: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  linkButton: {
    marginLeft: '0.5rem',
    padding: '0',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#2196F3',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  terms: {
    marginTop: '1.5rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  termsText: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#666',
    textAlign: 'center'
  },
  link: {
    color: '#2196F3',
    textDecoration: 'none'
  }
};

// 添加旋转动画
if (typeof document !== 'undefined') {
  const styleSheet = document.styleSheets[0];
  const keyframes = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  `;
  try {
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
  } catch (e) {
    // 动画可能已存在
  }
}

export default CustomerRegister;
import { useState, useEffect } from 'react';
import { functions } from '../../config/firebase';
import { httpsCallable } from 'firebase/functions';

/**
 * 通用的用户创建组件
 * 根据调用者角色 (callerRole) 动态显示可选角色
 * 
 * @param {string} organizationId - 组织 ID
 * @param {string} eventId - 活动 ID
 * @param {string} callerRole - 调用者角色 (event_manager, seller_manager, merchant_manager, customer_manager)
 * @param {function} onClose - 关闭回调
 * @param {function} onSuccess - 成功回调
 */
const AddUser = ({ organizationId, eventId, callerRole, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    phoneNumber: '',
    englishName: '',
    chineseName: '',
    email: '',
    password: '',
    confirmPassword: '',
    identityTag: 'staff',
    department: '',
    roles: [] // 多选的角色数组
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 根据 callerRole 获取可见的角色选项
  const getRoleOptions = () => {
    const allRoles = {
      seller_manager: { 
        value: 'seller_manager', 
        label: 'Seller Manager', 
        description: '销售管理员 - 管理销售团队和资本分配',
        icon: '💰'
      },
      merchant_manager: { 
        value: 'merchant_manager', 
        label: 'Merchant Manager', 
        description: '商家管理员 - 管理商家和 QR Code',
        icon: '🏪'
      },
      customer_manager: { 
        value: 'customer_manager', 
        label: 'Customer Manager', 
        description: '顾客管理员 - 义卖会当日销售',
        icon: '🎫'
      },
      seller: { 
        value: 'seller', 
        label: 'Seller', 
        description: '销售员 - 销售固本给顾客',
        icon: '💳'
      },
      merchant: { 
        value: 'merchant', 
        label: 'Merchant', 
        description: '商家 - 接收顾客消费',
        icon: '🏬'
      },
      customer: { 
        value: 'customer', 
        label: 'Customer', 
        description: '顾客 - 购买和使用固本',
        icon: '👤'
      }
    };

    // 根据调用者角色返回可见的角色
    switch (callerRole) {
      case 'event_manager':
        // Event Manager 可以看到所有角色
        return Object.values(allRoles);
      
      case 'seller_manager':
        // Seller Manager 只能创建 Seller 和 Customer
        return [allRoles.seller, allRoles.customer];
      
      case 'merchant_manager':
        // Merchant Manager 只能创建 Merchant 和 Customer
        return [allRoles.merchant, allRoles.customer];
      
      case 'customer_manager':
        // Customer Manager 只能创建 Customer
        return [allRoles.customer];
      
      default:
        return [];
    }
  };

  // 根据 callerRole 获取默认勾选的角色
  const getDefaultRoles = () => {
    switch (callerRole) {
      case 'event_manager':
        // Event Manager: 预设勾选 Customer（但可取消）
        return ['customer'];
      
      case 'seller_manager':
        // Seller Manager: 必须勾选 Seller 和 Customer
        return ['seller', 'customer'];
      
      case 'merchant_manager':
        // Merchant Manager: 必须勾选 Merchant 和 Customer
        return ['merchant', 'customer'];
      
      case 'customer_manager':
        // Customer Manager: 必须勾选 Customer
        return ['customer'];
      
      default:
        return [];
    }
  };

  // 判断某个角色是否可以取消勾选
  const isRoleDisabled = (roleValue) => {
    switch (callerRole) {
      case 'event_manager':
        // Event Manager 可以取消所有角色（完全自由）
        return false;
      
      case 'seller_manager':
        // Seller Manager 创建的用户必须是 Seller 和 Customer
        return ['seller', 'customer'].includes(roleValue);
      
      case 'merchant_manager':
        // Merchant Manager 创建的用户必须是 Merchant 和 Customer
        return ['merchant', 'customer'].includes(roleValue);
      
      case 'customer_manager':
        // Customer Manager 创建的用户必须是 Customer
        return roleValue === 'customer';
      
      default:
        return false;
    }
  };

  // 初始化默认角色
  useEffect(() => {
    const defaultRoles = getDefaultRoles();
    setFormData(prev => ({ ...prev, roles: defaultRoles }));
  }, [callerRole]);

  // 切换角色勾选状态
  const handleRoleToggle = (roleValue) => {
    // 如果角色被禁用，不允许切换
    if (isRoleDisabled(roleValue)) {
      return;
    }

    setFormData(prev => {
      const roles = prev.roles.includes(roleValue)
        ? prev.roles.filter(r => r !== roleValue)
        : [...prev.roles, roleValue];
      return { ...prev, roles };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // 验证至少选择一个角色
    if (formData.roles.length === 0) {
      setError('请至少选择一个角色');
      return;
    }

    // 验证密码
    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (formData.password.length < 8) {
      setError('密码至少需要 8 个字符');
      return;
    }

    if (!/[a-zA-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
      setError('密码必须包含英文字母和数字');
      return;
    }

    setLoading(true);

    try {
      // 调用后端函数
      const createUser = httpsCallable(functions, 'createUserByEventManager');
      const result = await createUser({
        organizationId,
        eventId,
        phoneNumber: formData.phoneNumber,
        password: formData.password,
        englishName: formData.englishName,
        chineseName: formData.chineseName,
        email: formData.email,
        identityTag: formData.identityTag,
        department: formData.department,
        roles: formData.roles
      });

      console.log('[AddUser] Success:', result.data);
      alert('用户创建成功！');
      
      if (onSuccess) {
        onSuccess();
      }
      
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('[AddUser] Error:', error);
      
      if (error.code === 'functions/already-exists') {
        setError('此手机号已被使用');
      } else if (error.code === 'functions/invalid-argument') {
        setError('请填写所有必填字段并至少选择一个角色');
      } else if (error.code === 'functions/permission-denied') {
        setError('权限不足，无法创建用户');
      } else {
        setError(error.message || '创建失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const roleOptions = getRoleOptions();

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>创建用户</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* 基本信息 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>📋 基本信息</h3>
            
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

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>英文名 / 拼音名 *</label>
                <input
                  type="text"
                  style={styles.input}
                  value={formData.englishName}
                  onChange={(e) => setFormData({ ...formData, englishName: e.target.value })}
                  placeholder="John Doe"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>中文名（可选）</label>
                <input
                  type="text"
                  style={styles.input}
                  value={formData.chineseName}
                  onChange={(e) => setFormData({ ...formData, chineseName: e.target.value })}
                  placeholder="张三"
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Email *</label>
              <input
                type="email"
                style={styles.input}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                required
              />
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>身份标签 *</label>
                <select
                  style={styles.select}
                  value={formData.identityTag}
                  onChange={(e) => setFormData({ ...formData, identityTag: e.target.value })}
                  required
                >
                  <option value="staff">Staff (职员)</option>
                  <option value="teacher">Teacher (教师)</option>
                  <option value="student">Student (学生)</option>
                  <option value="parent">Parent (家长)</option>
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>部门 / 班级（可选）</label>
                <input
                  type="text"
                  style={styles.input}
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  placeholder="例如：初一A班 / 行政部"
                />
              </div>
            </div>
          </div>

          {/* 密码设置 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>🔒 密码设置</h3>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>密码 *</label>
              <input
                type="password"
                style={styles.input}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="至少 8 个字符，包含字母和数字"
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>确认密码 *</label>
              <input
                type="password"
                style={styles.input}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="再次输入密码"
                required
              />
            </div>
          </div>

          {/* 角色分配 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>👥 角色分配 *</h3>
            <p style={styles.roleHint}>
              {callerRole === 'event_manager' 
                ? '请选择一个或多个角色（可多选）' 
                : '以下角色为必选项（已自动勾选）'}
            </p>
            
            <div style={styles.rolesGrid}>
              {roleOptions.map(role => {
                const isChecked = formData.roles.includes(role.value);
                const isDisabled = isRoleDisabled(role.value);
                
                return (
                  <div
                    key={role.value}
                    style={{
                      ...styles.roleCard,
                      borderColor: isChecked ? '#667eea' : '#e5e7eb',
                      background: isChecked ? '#f0f4ff' : 'white',
                      opacity: isDisabled ? 0.8 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer'
                    }}
                    onClick={() => !isDisabled && handleRoleToggle(role.value)}
                  >
                    <div style={styles.roleHeader}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={() => handleRoleToggle(role.value)}
                        style={{
                          ...styles.checkbox,
                          cursor: isDisabled ? 'not-allowed' : 'pointer'
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span style={styles.roleIcon}>{role.icon}</span>
                      <span style={styles.roleLabel}>{role.label}</span>
                      {isDisabled && (
                        <span style={styles.requiredBadge}>必选</span>
                      )}
                    </div>
                    <p style={styles.roleDescription}>{role.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          {/* 按钮 */}
          <div style={styles.actions}>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={onClose}
              disabled={loading}
            >
              取消
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              disabled={loading}
            >
              {loading ? '创建中...' : '创建用户'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '1rem',
    overflowY: 'auto'
  },
  modal: {
    background: 'white',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '900px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    margin: 'auto'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '2px solid #e5e7eb',
    position: 'sticky',
    top: 0,
    background: 'white',
    zIndex: 10
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0.25rem',
    width: '32px',
    height: '32px',
    borderRadius: '4px',
    transition: 'background 0.2s'
  },
  form: {
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem'
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  sectionTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0,
    paddingBottom: '0.5rem',
    borderBottom: '2px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem'
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
  select: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
    cursor: 'pointer',
    background: 'white'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  roleHint: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0 0 0.5rem 0'
  },
  rolesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1rem'
  },
  roleCard: {
    padding: '1rem',
    border: '2px solid',
    borderRadius: '12px',
    transition: 'all 0.2s'
  },
  roleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem'
  },
  checkbox: {
    width: '18px',
    height: '18px'
  },
  roleIcon: {
    fontSize: '1.25rem'
  },
  roleLabel: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937',
    flex: 1
  },
  requiredBadge: {
    padding: '0.125rem 0.5rem',
    background: '#fbbf24',
    color: '#78350f',
    borderRadius: '8px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  roleDescription: {
    fontSize: '0.75rem',
    color: '#6b7280',
    margin: 0,
    paddingLeft: '2rem'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  actions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
    paddingTop: '1rem',
    borderTop: '2px solid #e5e7eb',
    position: 'sticky',
    bottom: 0,
    background: 'white',
    marginTop: 'auto'
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '1rem',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  submitButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

export default AddUser;
import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { doc, getDoc } from 'firebase/firestore';

/**
 * 通用的用户创建组件
 * 根据调用者角色 (callerRole) 动态显示可选角色
 * 
 * @param {string} organizationId - 组织 ID
 * @param {string} eventId - 活动 ID
 * @param {string} callerRole - 调用者角色 (eventManager, sellerManager, merchantManager, customerManager)
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
    identityTag: '', // ✨ 不再设置默认值
    department: '',
    identityId: '', // ✨ 新增：学号/工号
    roles: [] // 多选的角色数组
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ✨ 新增：存储从 Organization 获取的身份标签
  const [identityTags, setIdentityTags] = useState([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [departments, setDepartments] = useState([]);
  // ✨ 新增：从 Firestore 加载 Organization 的 identityTags
  useEffect(() => {
    const loadIdentityTags = async () => {
      try {
        setLoadingTags(true);
        const orgRef = doc(db, 'organizations', organizationId);
        const orgSnap = await getDoc(orgRef);

        if (orgSnap.exists()) {
          const orgData = orgSnap.data();
          const tags = orgData.identityTags || [];

          // 只显示活跃的标签
          const activeTags = tags
            .filter(tag => tag.isActive)
            .sort((a, b) => a.displayOrder - b.displayOrder);

          setIdentityTags(activeTags);

          // ✨ 设置默认选中第一个标签
          if (activeTags.length > 0) {
            setFormData(prev => ({
              ...prev,
              identityTag: activeTags[0].id
            }));
          }
        }
      } catch (err) {
        console.error('[AddUser] 加载身份标签失败:', err);
        setError('加载身份标签失败: ' + err.message);
      } finally {
        setLoadingTags(false);
      }
    };

    if (organizationId) {
      loadIdentityTags();
    }
  }, [organizationId]);

  // 加载组织的部门列表
  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const orgRef = doc(db, 'organizations', organizationId);
        const orgSnap = await getDoc(orgRef);
        
        if (orgSnap.exists()) {
          const orgData = orgSnap.data();
          const depts = orgData.departments || [];
          setDepartments(depts.sort((a, b) => a.displayOrder - b.displayOrder));
        }
      } catch (err) {
        console.error('[AddUser] 加载部门列表失败:', err);
      }
    };

    if (organizationId) {
      loadDepartments();
    }
  }, [organizationId]);

  

  // 根据 callerRole 获取可见的角色选项
  const getRoleOptions = () => {
    const allRoles = {
      sellerManager: {
        value: 'sellerManager',
        label: 'Seller Manager',
        description: '销售管理员 - 管理销售团队和资本分配',
        icon: '💰'
      },
      merchantManager: {
        value: 'merchantManager',
        label: 'Merchant Manager',
        description: '商家管理员 - 管理商家和 QR Code',
        icon: '🏪'
      },
      customerManager: {
        value: 'customerManager',
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
      case 'eventManager':
        // Event Manager 可以看到所有角色
        return Object.values(allRoles);

      case 'sellerManager':
        // Seller Manager 只能创建 Seller 和 Customer
        return [allRoles.seller, allRoles.customer];

      case 'merchantManager':
        // Merchant Manager 只能创建 Merchant 和 Customer
        return [allRoles.merchant, allRoles.customer];

      case 'customerManager':
        // Customer Manager 只能创建 Customer
        return [allRoles.customer];

      default:
        return [];
    }
  };

  // 根据 callerRole 获取默认勾选的角色
  const getDefaultRoles = () => {
      switch (callerRole) {
        case 'eventManager':
          // Event Manager: 预设勾选 Customer（但可取消）
          return ['customer'];      case 'sellerManager':
        // Seller Manager: 必须勾选 Seller 和 Customer
        return ['seller', 'customer'];

      case 'merchantManager':
        // Merchant Manager: 必须勾选 Merchant 和 Customer
        return ['merchant', 'customer'];

      case 'customerManager':
        // Customer Manager: 必须勾选 Customer
        return ['customer'];

      default:
        return [];
    }
  };

  // 判断某个角色是否可以取消勾选
  const isRoleDisabled = (roleValue) => {
      switch (callerRole) {
        case 'eventManager':
          // Event Manager 可以取消所有角色（完全自由）
          return false;      case 'sellerManager':
        // Seller Manager 创建的用户必须是 Seller 和 Customer
        return ['seller', 'customer'].includes(roleValue);

      case 'merchantManager':
        // Merchant Manager 创建的用户必须是 Merchant 和 Customer
        return ['merchant', 'customer'].includes(roleValue);

      case 'customerManager':
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
      // ✅ 修复：调用正确的 API 端点，email 改为可选
      const response = await fetch(
        'https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/createUserByEventManagerHttp',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            organizationId,
            eventId,
            phoneNumber: formData.phoneNumber,
            password: formData.password,
            englishName: formData.englishName,
            chineseName: formData.chineseName,
            email: formData.email || '', // ✅ email 改为可选，空字符串也可以
            identityTag: formData.identityTag,
            department: formData.department,
            identityId: formData.identityId, // ✨ 新增：传递 identityId
            roles: formData.roles
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '创建失败');
      }

      const result = await response.json();
      console.log('[AddUser] Success:', result);
      alert('用户创建成功！');

      if (onSuccess) {
        onSuccess();
      }

      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('[AddUser] Error:', error);

      if (error.message.includes('已被使用') || error.message.includes('已在此活动中注册')) {
        setError('此手机号已被使用');
      } else if (error.message.includes('必填字段')) {
        setError('请填写所有必填字段并至少选择一个角色');
      } else if (error.message.includes('权限不足')) {
        setError('权限不足，无法创建用户');
      } else {
        setError(error.message || '创建失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const roleOptions = getRoleOptions();

  // ✨ 如果还在加载身份标签，显示加载状态
  if (loadingTags) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.loadingContainer}>
            <div style={styles.spinner}></div>
            <div>加载中...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* 头部 */}
        <div style={styles.header}>
          <h2 style={styles.title}>添加用户</h2>
          <button
            onClick={onClose}
            style={styles.closeButton}
            disabled={loading}
          >
            ✕
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {/* 基本信息 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>
              <span>👤</span>
              基本信息
            </h3>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>英文名 *</label>
                <input
                  type="text"
                  value={formData.englishName}
                  onChange={(e) => setFormData({ ...formData, englishName: e.target.value })}
                  style={styles.input}
                  placeholder="John Doe"
                  required
                  disabled={loading}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>中文名</label>
                <input
                  type="text"
                  value={formData.chineseName}
                  onChange={(e) => setFormData({ ...formData, chineseName: e.target.value })}
                  style={styles.input}
                  placeholder="张三"
                  disabled={loading}
                />
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>手机号码 *</label>
                <input
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  style={styles.input}
                  placeholder="0123456789"
                  required
                  disabled={loading}
                />
                <span style={styles.hint}>10位数字，以0开头</span>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>邮箱</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={styles.input}
                  placeholder="user@example.com"
                  disabled={loading}
                />
                <span style={styles.hint}>可选填</span>
              </div>
            </div>
          </div>

          {/* 身份信息 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>
              <span>🎓</span>
              身份信息
            </h3>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>身份标签 *</label>
                <select
                  value={formData.identityTag}
                  onChange={(e) => setFormData({ ...formData, identityTag: e.target.value })}
                  style={styles.select}
                  required
                  disabled={loading || identityTags.length === 0}
                >
                  <option value="">请选择身份标签</option>
                  {identityTags.map(tag => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name['zh-CN']} ({tag.name['en']})
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>学号/工号</label>
                <input
                  type="text"
                  value={formData.identityId}
                  onChange={(e) => setFormData({ ...formData, identityId: e.target.value })}
                  style={styles.input}
                  placeholder="如: 2024001 或 T2024001"
                  disabled={loading}
                />
                <span style={styles.hint}>可选，如组织有发放请填写</span>
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>部门</label>
              <select
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                style={styles.select}
                disabled={loading}
              >
                <option value="">请选择部门</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.name}>
                    {dept.name} ({dept.userCount || 0} 人)
                  </option>
                ))}
              </select>
              <span style={styles.hint}>可选，如果没有合适的部门可以留空</span>
            </div>
          </div>

          {/* 密码设置 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>
              <span>🔒</span>
              密码设置
            </h3>
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>密码 *</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  style={styles.input}
                  placeholder="至少8位，包含字母和数字"
                  required
                  disabled={loading}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>确认密码 *</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  style={styles.input}
                  placeholder="再次输入密码"
                  required
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* 角色选择 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>
              <span>🎭</span>
              角色选择
            </h3>
            <p style={styles.roleHint}>请选择用户将担任的角色（可多选）</p>
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
                      backgroundColor: isChecked ? '#eef2ff' : 'white',
                      opacity: loading ? 0.6 : 1,
                      cursor: loading || isDisabled ? 'not-allowed' : 'pointer'
                    }}
                    onClick={() => !loading && handleRoleToggle(role.value)}
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

          {/* ✨ 警告：没有身份标签时 */}
          {identityTags.length === 0 && (
            <div style={styles.warningBox}>
              ⚠️ <strong>警告：</strong>此组织还没有设置身份标签。
              <br />
              请联系 Platform Admin 在组织管理中设置身份标签。
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
                opacity: (loading || identityTags.length === 0) ? 0.6 : 1,
                cursor: (loading || identityTags.length === 0) ? 'not-allowed' : 'pointer'
              }}
              disabled={loading || identityTags.length === 0}
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
  // ✨ 新增：加载状态样式
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '1rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTopColor: '#667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
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
  // ✨ 新增：警告框样式
  warningBox: {
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    color: '#92400e',
    padding: '1rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    lineHeight: '1.5'
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

// 添加旋转动画
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export default AddUser;
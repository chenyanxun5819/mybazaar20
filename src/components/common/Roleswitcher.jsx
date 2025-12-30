import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 角色切换组件
 * 
 * @param {Object} props
 * @param {string} props.currentRole - 当前角色
 * @param {Array} props.availableRoles - 可用角色列表
 * @param {string} props.orgEventCode - 组织活动代码
 * @param {Object} props.userInfo - 用户信息
 * 
 * @description
 * 显示在 Dashboard 顶部，允许用户在可用角色之间切换
 * 根据设备类型显示不同的角色选项
 */
const RoleSwitcher = ({ currentRole, availableRoles, orgEventCode, userInfo }) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  // 角色配置
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

  // 角色到路由的映射
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

  /**
   * 切换角色
   */
  const handleRoleSwitch = (newRole) => {
    if (newRole === currentRole) {
      setIsOpen(false);
      return;
    }

    // 更新 localStorage
    const newStorageKey = storageKeys[newRole];
    if (newStorageKey) {
      const updatedInfo = {
        ...userInfo,
        currentRole: newRole,
        availableRoles: availableRoles
      };
      localStorage.setItem(newStorageKey, JSON.stringify(updatedInfo));
    }

    // 跳转到新角色的 Dashboard
    const route = roleRoutes[newRole];
    if (route) {
      console.log('[RoleSwitcher] 切换角色:', currentRole, '->', newRole);
      navigate(route);
      setIsOpen(false);
    }
  };

  // 如果只有一个角色，不显示切换器
  if (!availableRoles || availableRoles.length <= 1) {
    return null;
  }

  const currentConfig = roleConfig[currentRole] || { label: currentRole, icon: '👤', color: '#6b7280' };

  return (
    <div style={styles.container}>
      {/* 当前角色按钮 */}
      <button
        style={{
          ...styles.currentRoleButton,
          borderColor: currentConfig.color
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span style={{ fontSize: '1.25rem' }}>{currentConfig.icon}</span>
        <span style={styles.roleLabel}>{currentConfig.label}</span>
        <span style={{
          ...styles.arrow,
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
        }}>
          ▼
        </span>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <div 
            style={styles.overlay}
            onClick={() => setIsOpen(false)}
          />
          
          {/* 角色列表 */}
          <div style={styles.dropdown}>
            <div style={styles.dropdownHeader}>切换身份</div>
            {availableRoles.map(role => {
              const config = roleConfig[role] || { label: role, icon: '👤', color: '#6b7280' };
              const isCurrentRole = role === currentRole;
              
              return (
                <button
                  key={role}
                  style={{
                    ...styles.roleOption,
                    background: isCurrentRole ? `${config.color}15` : 'white',
                    borderLeft: isCurrentRole ? `4px solid ${config.color}` : '4px solid transparent'
                  }}
                  onClick={() => handleRoleSwitch(role)}
                  disabled={isCurrentRole}
                >
                  <span style={{ fontSize: '1.5rem' }}>{config.icon}</span>
                  <div style={styles.roleInfo}>
                    <div style={styles.roleName}>{config.label}</div>
                    {isCurrentRole && (
                      <div style={{ 
                        fontSize: '0.75rem', 
                        color: config.color,
                        fontWeight: '600'
                      }}>
                        当前身份
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'relative',
    display: 'inline-block'
  },
  currentRoleButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1.25rem',
    background: 'white',
    border: '2px solid',
    borderRadius: '12px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    transition: 'all 0.2s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  roleLabel: {
    color: '#1f2937'
  },
  arrow: {
    fontSize: '0.75rem',
    color: '#6b7280',
    transition: 'transform 0.2s',
    marginLeft: '0.5rem'
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'transparent',
    zIndex: 999
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 0.5rem)',
    left: 0,
    minWidth: '280px',
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
    zIndex: 1000,
    overflow: 'hidden',
    border: '1px solid #e5e7eb'
  },
  dropdownHeader: {
    padding: '1rem 1.25rem',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  roleOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    width: '100%',
    padding: '1rem 1.25rem',
    background: 'white',
    border: 'none',
    borderBottom: '1px solid #f3f4f6',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left'
  },
  roleInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  roleName: {
    fontSize: '0.95rem',
    fontWeight: '500',
    color: '#1f2937'
  }
};

export default RoleSwitcher;

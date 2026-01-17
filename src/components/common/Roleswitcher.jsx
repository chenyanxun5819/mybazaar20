import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import UsersIcon from '../../assets/users.svg?react';
import ChalkboardUserIcon from '../../assets/chalkboard-user.svg?react';
import SellerFiveIcon from '../../assets/seller (5).svg?react';
import UsersGearIcon from '../../assets/users-gear.svg?react';
import UserSalaryIcon from '../../assets/user-salary.svg?react';
import EmployeeManIcon from '../../assets/employee-man.svg?react';
import StoreBuyerIcon from '../../assets/store-buyer.svg?react';
import SellerFourIcon from '../../assets/seller (4).svg?react';
import MoneyCheckEditIcon from '../../assets/money-check-edit (1).svg?react';
import UserBagIcon from '../../assets/user-bag.svg?react';

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

  const isMobile = (() => {
    if (typeof window === 'undefined') return false;
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    const touchCapable = 'ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0);
    return uaMobile || touchCapable;
  })();

  // 角色配置（图标参考 EventManagerDashboard ROLE_CONFIG）
  const roleConfig = {
    platformAdmin: { label: 'Platform Admin', buttonLabel: 'Platform\nAdmin', icon: UsersGearIcon, color: '#ef4444', category: 'manager' },
    eventManager: { label: 'Event Manager', buttonLabel: 'Event\nManager', icon: UsersIcon, color: '#667eea', category: 'manager' },
    sellerManager: { label: 'Seller Manager', buttonLabel: 'Seller\nManager', icon: ChalkboardUserIcon, color: '#f59e0b', category: 'manager' },
    merchantManager: { label: 'Merchant Manager', buttonLabel: 'Merchant\nManager', icon: SellerFiveIcon, color: '#8b5cf6', category: 'manager' },
    customerManager: { label: 'Customer Manager', buttonLabel: 'Customer\nManager', icon: UsersGearIcon, color: '#10b981', category: 'manager' },
    cashier: { label: 'Cashier (收银员)', buttonLabel: 'Cashier\n(收银员)', icon: UserSalaryIcon, color: '#3b82f6', category: 'manager' },

    seller: { label: 'Seller (销售员)', buttonLabel: 'Seller\n(销售员)', icon: EmployeeManIcon, color: '#ec4899', category: 'user' },
    merchantOwner: { label: 'Merchant Owner (摊主)', buttonLabel: 'Merchant\nOwner', icon: StoreBuyerIcon, color: '#84cc16', category: 'user' },
    merchantAsist: { label: 'Merchant Assistant (助理)', buttonLabel: 'Merchant\nAsist', icon: SellerFourIcon, color: '#a3e635', category: 'user' },
    pointSeller: { label: 'Point Seller (点数直售员)', buttonLabel: 'Point\nSeller', icon: MoneyCheckEditIcon, color: '#f97316', category: 'user' },
    customer: { label: 'Customer (顾客)', buttonLabel: 'Customer\n(顾客)', icon: UserBagIcon, color: '#ec4899', category: 'user' }
  };

  // 角色到路由的映射（用 resolvedOrgEventCode 动态组装，避免 orgEventCode 缺省）
  const roleRouteBuilders = {
    platformAdmin: () => '/platform-admin/dashboard',
    eventManager: (code) => `/event-manager/${code}/dashboard`,
    sellerManager: (code) => `/seller-manager/${code}/dashboard`,
    merchantManager: (code) => `/merchant-manager/${code}/dashboard`,
    customerManager: (code) => `/customer-manager/${code}/dashboard`,
    cashier: (code) => `/cashier/${code}/dashboard`,
    seller: (code) => `/seller/${code}/dashboard`,
    pointSeller: (code) => `/pointseller/${code}/dashboard`,
    merchantOwner: (code) => `/merchant/${code}/dashboard`,
    merchantAsist: (code) => `/merchant/${code}/dashboard`,
    customer: (code) => `/customer/${code}/dashboard`
  };

  // localStorage key 映射
  const storageKeys = {
    'platformAdmin': 'platformAdminInfo',
    'eventManager': 'eventManagerInfo',
    'sellerManager': 'sellerManagerInfo',
    'merchantManager': 'merchantManagerInfo',
    'customerManager': 'customerManagerInfo',
    'cashier': 'cashierInfo',
    'seller': 'sellerInfo',
    'pointSeller': 'pointSellerInfo',
    'merchantOwner': 'merchantOwnerInfo',
    'merchantAsist': 'merchantAsistInfo',
    'customer': 'customerInfo'
  };

  const safeJsonParse = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const fallbackStorageKey = currentRole ? storageKeys[currentRole] : null;
  const storedInfo = !userInfo && fallbackStorageKey
    ? safeJsonParse(localStorage.getItem(fallbackStorageKey))
    : null;

  const resolvedUserInfo = userInfo || storedInfo || {};
  const resolvedOrgEventCode = orgEventCode || resolvedUserInfo.orgEventCode || (
    resolvedUserInfo.organizationCode && resolvedUserInfo.eventCode
      ? `${resolvedUserInfo.organizationCode}-${resolvedUserInfo.eventCode}`
      : ''
  );

  const resolvedAvailableRolesRaw =
    (Array.isArray(availableRoles) && availableRoles.length > 0)
      ? availableRoles
      : (Array.isArray(resolvedUserInfo.availableRoles) && resolvedUserInfo.availableRoles.length > 0)
        ? resolvedUserInfo.availableRoles
        : (Array.isArray(resolvedUserInfo.roles) ? resolvedUserInfo.roles : []);

  const resolvedAvailableRoles = Array.from(new Set(
    (currentRole ? [currentRole, ...resolvedAvailableRolesRaw] : [...resolvedAvailableRolesRaw])
      .filter(Boolean)
  ));

  // 设备过滤规则（按你的要求）
  // - Desktop: 只显示 manager + cashier
  // - Mobile: 只显示非 manager（手机角色），并包含 pointSeller
  const desktopOnlyRoles = ['platformAdmin', 'eventManager', 'sellerManager', 'merchantManager', 'customerManager', 'cashier'];
  const mobileOnlyRoles = ['seller', 'customer', 'merchantOwner', 'merchantAsist', 'pointSeller'];

  const deviceFilteredRoles = (resolvedAvailableRoles || []).filter((role) =>
    isMobile ? mobileOnlyRoles.includes(role) : desktopOnlyRoles.includes(role)
  );

  const renderRoleIcon = (icon, { size = 18, color } = {}) => {
    if (!icon) return null;
    if (typeof icon === 'string') {
      return <span style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>;
    }
    if (typeof icon === 'function') {
      const IconComp = icon;
      return <IconComp aria-hidden="true" style={{ width: size, height: size, color, flexShrink: 0 }} />;
    }
    return null;
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
        ...resolvedUserInfo,
        currentRole: newRole,
        availableRoles: resolvedAvailableRoles
      };
      localStorage.setItem(newStorageKey, JSON.stringify(updatedInfo));
    }

    // 跳转到新角色的 Dashboard
    const routeBuilder = roleRouteBuilders[newRole];
    const route = typeof routeBuilder === 'function'
      ? routeBuilder(resolvedOrgEventCode)
      : '';

    if (route && (!route.includes('/undefined/') && !route.includes('/null/') && !route.endsWith('//dashboard'))) {
      console.log('[RoleSwitcher] 切换角色:', currentRole, '->', newRole);
      navigate(route);
      setIsOpen(false);
    }
  };

  // 如果只有一个角色，不显示切换器
  if (!deviceFilteredRoles || deviceFilteredRoles.length <= 1) {
    return null;
  }

  const currentConfig = roleConfig[currentRole] || { label: currentRole, icon: UsersIcon, color: '#6b7280' };

  return (
    <div style={styles.container}>
      {/* 当前角色按钮 */}
      <button
        type="button"
        style={styles.currentRoleButton}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="切换身份"
      >
        {renderRoleIcon(currentConfig.icon, { size: 24, color: currentConfig.color })}
        {isOpen && (
          <span style={styles.currentRoleLabel}>
            {currentConfig.buttonLabel || currentConfig.label}
          </span>
        )}
        <span
          aria-hidden="true"
          style={{
            ...styles.currentRoleCaret,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
          }}
        >
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
            {deviceFilteredRoles.map(role => {
              const config = roleConfig[role] || { label: role, icon: UsersIcon, color: '#6b7280' };
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
                  {renderRoleIcon(config.icon, { size: 24, color: config.color })}
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
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    padding: '0.5rem 0.75rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background-color 0.2s, transform 0.12s',
    lineHeight: 1,
    minWidth: '88px'
  },
  currentRoleLabel: {
    color: '#111827',
    fontSize: '0.75rem',
    fontWeight: '700',
    textAlign: 'center',
    whiteSpace: 'pre-line'
  },
  currentRoleCaret: {
    position: 'absolute',
    top: '0.35rem',
    right: '0.35rem',
    fontSize: '0.7rem',
    color: '#6b7280',
    transition: 'transform 0.2s'
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

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import AddUser from '../../components/common/AddUser'; // 🆕 通用组件
import BatchImportUser from '../../components/common/BatchImportUser'; // 🆕 批量导入
import UserList from '../../components/common/UserList';
import UserManagement from '../../components/common/UserManagement'; // 🆕 用户管理和点数分配
import DepartmentManagement from '../../components/common/DepartmentManagement'; // 部门管理
import RoleSwitcher from '../../components/common/RoleSwitcher'; // 🆕 角色切换器

const EventManagerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  // 新增：为 UserList 传参准备独立的组织/活动 ID state
  const [organizationId, setOrganizationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [showAddUser, setShowAddUser] = useState(false); // 🆕
  const [showBatchImport, setShowBatchImport] = useState(false); // 🆕 批量导入
  const [statistics, setStatistics] = useState({
    totalUsers: 0,
    totalSellerManagers: 0,
    totalMerchantManagers: 0,
    totalCustomerManagers: 0,
    totalSellers: 0,
    totalMerchants: 0,
    totalCustomers: 0
  });
  const [showUserList, setShowUserList] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false); // 🆕 用户管理
  const [showDepartmentManagement, setShowDepartmentManagement] = useState(false); // 部门管理
  const [users, setUsers] = useState([]); // 用户列表（表格显示）
  const [showUserTable, setShowUserTable] = useState(true); // 默认显示用户表格

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // 从 localStorage 获取用户信息（兼容两种 key）
      const storedInfo = localStorage.getItem('eventManagerInfo') || localStorage.getItem('eventManagerLogin');
      if (!storedInfo) {
        alert('请先登录');
        if (orgEventCode) {
          navigate(`/login/${orgEventCode}`);
        }
        return;
      }

      const info = JSON.parse(storedInfo);
      setUserInfo(info);
      // 同步设置 organizationId 和 eventId，以供 UserList 等组件使用
      if (info?.organizationId) setOrganizationId(info.organizationId);
      if (info?.eventId) setEventId(info.eventId);

      // 加载组织信息
      const orgDoc = await getDoc(doc(db, 'organizations', info.organizationId));
      if (orgDoc.exists()) {
        setOrgData(orgDoc.data());
      }

      // 加载活动信息（使用子集合）
      const eventDoc = await getDoc(
        doc(db, 'organizations', info.organizationId, 'events', info.eventId)
      );

      if (eventDoc.exists()) {
        const eventInfo = eventDoc.data();
        setEventData(eventInfo);

        // 加载用户统计（使用子集合）
        const usersSnapshot = await getDocs(
          collection(db, 'organizations', info.organizationId, 'events', info.eventId, 'users')
        );

        let stats = {
          totalUsers: usersSnapshot.size,
          totalSellerManagers: 0,
          totalMerchantManagers: 0,
          totalCustomerManagers: 0,
          totalSellers: 0,
          totalMerchants: 0,
          totalCustomers: 0
        };

        // 加载用户列表数据（用于表格显示）
        const userList = [];

        usersSnapshot.forEach(doc => {
          const userData = doc.data();
          userList.push({
            id: doc.id,
            ...userData
          });

          if (userData.roles?.includes('seller_manager')) stats.totalSellerManagers++;
          if (userData.roles?.includes('merchant_manager')) stats.totalMerchantManagers++;
          if (userData.roles?.includes('customer_manager')) stats.totalCustomerManagers++;
          if (userData.roles?.includes('seller')) stats.totalSellers++;
          if (userData.roles?.includes('merchant')) stats.totalMerchants++;
          if (userData.roles?.includes('customer')) stats.totalCustomers++;
        });

        setStatistics(stats);
        setUsers(userList); // 保存用户列表
      }
    } catch (error) {
      console.error('[EventManagerDashboard] 加载失败:', error);
      alert(`加载失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('eventManagerInfo');
      localStorage.removeItem('eventManagerLogin');
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('[Logout] 错误:', error);
      alert('退出登录失败');
    }
  };

  // 加载中状态
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header with Role Switcher */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div>
            <h1 style={styles.title}>
              🎯 Event Manager Dashboard
            </h1>
            <p style={styles.subtitle}>
              {orgData?.orgName?.['zh-CN'] || '组织'} - {eventData?.eventName?.['zh-CN'] || '活动'}
            </p>
          </div>
          {/* 🆕 角色切换器 */}
          {userInfo?.availableRoles && userInfo.availableRoles.length > 1 && (
            <div style={styles.roleSwitcherWrapper}>
              <RoleSwitcher
                currentRole={userInfo.currentRole || 'eventManager'}
                availableRoles={userInfo.availableRoles}
                orgEventCode={orgEventCode}
                userInfo={userInfo}
              />
            </div>
          )}
        </div>
        <div style={styles.headerActions}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>👤 {userInfo?.englishName}</span>
          </div>
          <button style={styles.logoutButton} onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div style={styles.statsGrid}>
        <StatCard
          title="总用户数"
          value={statistics.totalUsers}
          icon="👥"
          color="#667eea"
        />
        <StatCard
          title="Seller Managers"
          value={statistics.totalSellerManagers}
          icon="💰"
          color="#10b981"
        />
        <StatCard
          title="Merchant Managers"
          value={statistics.totalMerchantManagers}
          icon="🏪"
          color="#f59e0b"
        />
        <StatCard
          title="Customer Managers"
          value={statistics.totalCustomerManagers}
          icon="🎫"
          color="#ec4899"
        />
      </div>

      {/* Quick Actions Bar */}
      <div style={styles.quickActionsBar}>
        <button
          style={styles.primaryButton}
          onClick={() => setShowBatchImport(true)}
        >
          📥 批量导入用户
        </button>
        <button
          style={styles.secondaryButton}
          onClick={() => setShowAddUser(true)}
        >
          ➕ 单个创建用户
        </button>
        <button
          style={{...styles.secondaryButton, backgroundColor: '#f59e0b', color: 'white', borderColor: '#f59e0b'}}
          onClick={() => setShowDepartmentManagement(true)}
        >
          🏢 部门管理
        </button>
        <button
          style={{...styles.secondaryButton, backgroundColor: '#10b981', color: 'white', borderColor: '#10b981'}}
          onClick={() => setShowUserManagement(true)}
        >
          🎭 角色分配 & 点数
        </button>
      </div>

      {/* User Table Section */}
      <div style={styles.tableSection}>
        <div style={styles.tableHeader}>
          <h2 style={styles.sectionTitle}>用户管理</h2>
          <div style={styles.tableStats}>
            共 <strong>{users.length}</strong> 个用户
          </div>
        </div>

        {users.length > 0 ? (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeaderRow}>
                  <th style={styles.tableCell}>姓名</th>
                  <th style={styles.tableCell}>手机号</th>
                  <th style={styles.tableCell}>邮箱</th>
                  <th style={styles.tableCell}>部门</th>
                  <th style={styles.tableCell}>学号/工号</th>
                  <th style={styles.tableCell}>身份</th>
                  <th style={styles.tableCell}>角色</th>
                  <th style={styles.tableCell}>状态</th>
                  <th style={styles.tableCell}>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, index) => (
                  <tr key={user.id} style={{...styles.tableRow, backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb'}}>
                    <td style={styles.tableCell}>
                      <strong>{user.basicInfo?.englishName || '-'}</strong>
                      {user.basicInfo?.chineseName && (
                        <div style={{fontSize: '0.75rem', color: '#6b7280'}}>
                          {user.basicInfo.chineseName}
                        </div>
                      )}
                    </td>
                    <td style={styles.tableCell}>{user.phoneNumber || '-'}</td>
                    <td style={styles.tableCell}>{user.email || '-'}</td>
                    <td style={styles.tableCell}>
                      {user.departmentInfo?.departmentName?.['zh-CN'] || '-'}
                    </td>
                    <td style={styles.tableCell}>{user.studentId || user.employeeId || '-'}</td>
                    <td style={styles.tableCell}>
                      <span style={{
                        ...styles.badge,
                        backgroundColor: user.identity === 'student' ? '#dbeafe' : '#fef3c7',
                        color: user.identity === 'student' ? '#1e40af' : '#92400e'
                      }}>
                        {user.identity === 'student' ? '学生' : user.identity === 'employee' ? '员工' : '-'}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      <div style={styles.rolesContainer}>
                        {user.roles?.map(role => {
                          const roleLabels = {
                            'seller_manager': 'SM',
                            'merchant_manager': 'MM',
                            'customer_manager': 'CM',
                            'seller': 'S',
                            'merchant': 'M',
                            'customer': 'C'
                          };
                          const roleColors = {
                            'seller_manager': '#10b981',
                            'merchant_manager': '#f59e0b',
                            'customer_manager': '#ec4899',
                            'seller': '#06b6d4',
                            'merchant': '#84cc16',
                            'customer': '#8b5cf6'
                          };
                          return (
                            <span
                              key={role}
                              style={{
                                ...styles.roleBadge,
                                backgroundColor: `${roleColors[role]}20`,
                                color: roleColors[role]
                              }}
                            >
                              {roleLabels[role] || role}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td style={styles.tableCell}>
                      <span style={{
                        ...styles.badge,
                        backgroundColor: user.status === 'active' ? '#d1fae5' : '#fee2e2',
                        color: user.status === 'active' ? '#065f46' : '#991b1b'
                      }}>
                        {user.status === 'active' ? '活跃' : '停用'}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>暂无用户数据</p>
            <button style={styles.primaryButton} onClick={() => setShowAddUser(true)}>
              创建第一个用户
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAddUser && (
        <AddUser
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => {
            setShowAddUser(false);
            loadDashboardData();
          }}
          currentUserRole="eventManager"
        />
      )}

      {showBatchImport && (
        <BatchImportUser
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => {
            setShowBatchImport(false);
            loadDashboardData();
          }}
          currentUserRole="eventManager"
        />
      )}

      {showUserManagement && (
        <UserManagement
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => {
            setShowUserManagement(false);
            loadDashboardData();
          }}
        />
      )}

      {showDepartmentManagement && (
        <DepartmentManagement
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => {
            setShowDepartmentManagement(false);
            loadDashboardData();
          }}
        />
      )}
    </div>
  );
};

// Statistics Card Component
const StatCard = ({ title, value, icon, color }) => (
  <div style={{ ...styles.statCard, borderLeftColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{title}</div>
    </div>
  </div>
);

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '2rem'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: '1rem'
  },
  spinner: {
    width: '3rem',
    height: '3rem',
    border: '4px solid #e5e7eb',
    borderTopColor: '#667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2rem',
    background: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '2rem'
  },
  roleSwitcherWrapper: {
    display: 'flex',
    alignItems: 'center',
    paddingTop: '0.5rem'
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
  headerActions: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center'
  },
  userInfo: {
    padding: '0.5rem 1rem',
    background: '#f3f4f6',
    borderRadius: '8px'
  },
  userName: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151'
  },
  logoutButton: {
    padding: '0.5rem 1rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  statCard: {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    borderLeft: '4px solid'
  },
  statIcon: {
    fontSize: '2.5rem'
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statLabel: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  quickActionsBar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap'
  },
  primaryButton: {
    padding: '0.75rem 1.5rem',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    transition: 'all 0.2s'
  },
  secondaryButton: {
    padding: '0.75rem 1.5rem',
    background: 'white',
    color: '#374151',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    transition: 'all 0.2s'
  },
  tableSection: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    padding: '1.5rem'
  },
  tableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  tableStats: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeaderRow: {
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb'
  },
  tableCell: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.875rem',
    color: '#374151'
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  rolesContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.25rem'
  },
  roleBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    borderRadius: '8px',
    fontSize: '0.7rem',
    fontWeight: '700'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  emptyText: {
    fontSize: '1rem',
    marginBottom: '1rem'
  }
};

export default EventManagerDashboard;
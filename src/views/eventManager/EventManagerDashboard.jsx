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

        usersSnapshot.forEach(doc => {
          const userData = doc.data();
          if (userData.roles?.includes('seller_manager')) stats.totalSellerManagers++;
          if (userData.roles?.includes('merchant_manager')) stats.totalMerchantManagers++;
          if (userData.roles?.includes('customer_manager')) stats.totalCustomerManagers++;
          if (userData.roles?.includes('seller')) stats.totalSellers++;
          if (userData.roles?.includes('merchant')) stats.totalMerchants++;
          if (userData.roles?.includes('customer')) stats.totalCustomers++;
        });

        // 加载用户列表（表格显示）
        const usersList = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setUsers(usersList);
        setStatistics(stats);
      }

    } catch (error) {
      console.error('[Dashboard] Error loading data:', error);
      alert('加载数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
      try {
        await signOut(auth);
        localStorage.removeItem('eventManagerInfo');
        if (orgEventCode) {
          navigate(`/login/${orgEventCode}`);
        }
      } catch (error) {
        console.error('[Dashboard] Logout error:', error);
        alert('退出登录失败');
      }
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>
            🎯 Event Manager Dashboard
          </h1>
          <p style={styles.subtitle}>
            {orgData?.orgName?.['zh-CN'] || '组织'} - {eventData?.eventName?.['zh-CN'] || '活动'}
          </p>
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
                    <td style={styles.tableCell}>{user.basicInfo?.phoneNumber || '-'}</td>
                    <td style={styles.tableCell}>{user.basicInfo?.email || '-'}</td>
                    <td style={styles.tableCell}>{user.department || '-'}</td>
                    <td style={styles.tableCell}>{user.identityInfo?.studentId || user.identityInfo?.staffId || '-'}</td>
                    <td style={styles.tableCell}>
                      <span style={{...styles.badge, background: user.identityTag === 'student' ? '#dbeafe' : '#fef3c7', color: user.identityTag === 'student' ? '#1e40af' : '#92400e'}}>
                        {user.identityTag === 'student' ? '学生' : user.identityTag === 'staff' ? '员工' : user.identityTag === 'teacher' ? '教师' : '-'}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      <div style={styles.roleContainer}>
                        {user.roles?.map((role, i) => (
                          <span key={i} style={{...styles.roleBadge, background: getRoleColor(role)}}>
                            {formatRole(role)}
                          </span>
                        )) || '-'}
                      </div>
                    </td>
                    <td style={styles.tableCell}>
                      <span style={{...styles.badge, background: user.accountStatus?.status === 'active' ? '#dcfce7' : '#fee2e2', color: user.accountStatus?.status === 'active' ? '#166534' : '#991b1b'}}>
                        {user.accountStatus?.status === 'active' ? '活跃' : '禁用'}
                      </span>
                    </td>
                    <td style={{...styles.tableCell, fontSize: '0.875rem', color: '#6b7280'}}>
                      {user.activityData?.joinedAt 
                        ? new Date(user.activityData.joinedAt.toDate?.() || user.activityData.joinedAt).toLocaleDateString('zh-CN')
                        : '-'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📭</div>
            <p style={styles.emptyText}>暂无用户数据</p>
          </div>
        )}
      </div>

      {/* 创建用户弹窗 */}
      {showAddUser && organizationId && eventId && (
        <AddUser
          organizationId={organizationId}
          eventId={eventId}
          callerRole="eventManager" // 🆕 指定调用者角色 (camelCase)
          onClose={() => setShowAddUser(false)}
          onSuccess={() => {
            loadDashboardData(); // 刷新数据
          }}
        />
      )}

      {/* 批量导入用户弹窗 */}
      {showBatchImport && organizationId && eventId && (
        <BatchImportUser
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => setShowBatchImport(false)}
          onSuccess={() => {
            setShowBatchImport(false);
            loadDashboardData(); // 刷新数据
          }}
        />
      )}

      {/* UserList Modal */}
      {showUserList && organizationId && eventId && (
        <UserList
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => setShowUserList(false)}
        />
      )}

      {/* UserManagement Modal */}
      {showUserManagement && organizationId && eventId && (
        <UserManagement
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => setShowUserManagement(false)}
          onUpdate={loadDashboardData}
        />
      )}

      {/* DepartmentManagement Modal */}
      {showDepartmentManagement && organizationId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            maxWidth: '1200px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowDepartmentManagement(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                zIndex: 1
              }}
            >
              ✕
            </button>
            <DepartmentManagement organizationId={organizationId} eventId={eventId} />
          </div>
        </div>
      )}
    </div>
  );
};

// Stat Card Component
const StatCard = ({ title, value, icon, color }) => (
  <div style={{ ...styles.statCard, borderTopColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
    </div>
  </div>
);

// Info Item Component
const InfoItem = ({ label, value, icon }) => (
  <div style={styles.infoItem}>
    <div style={styles.infoIcon}>{icon}</div>
    <div>
      <div style={styles.infoLabel}>{label}</div>
      <div style={styles.infoValue}>{value}</div>
    </div>
  </div>
);

// Action Card Component
const ActionCard = ({ title, description, icon, onClick, color, badge }) => (
  <div
    style={styles.actionCard}
    onClick={onClick}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
      e.currentTarget.style.borderColor = color;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = 'none';
      e.currentTarget.style.borderColor = 'transparent';
    }}
  >
    <div style={{ ...styles.actionIcon, background: `${color}20`, color }}>
      {icon}
    </div>
    {badge && (
      <div style={{ ...styles.actionBadge, background: color }}>
        {badge}
      </div>
    )}
    <h3 style={styles.actionTitle}>{title}</h3>
    <p style={styles.actionDescription}>{description}</p>
    <div style={{ ...styles.actionArrow, color }}>→</div>
  </div>
);

// 辅助函数：格式化角色名称
function formatRole(role) {
  const roleMap = {
    'eventManager': 'Event Manager',
    'event_manager': 'Event Manager',
    'sellerManager': 'Seller Manager',
    'seller_manager': 'Seller Manager',
    'merchantManager': 'Merchant Manager',
    'merchant_manager': 'Merchant Manager',
    'customerManager': 'Customer Manager',
    'customer_manager': 'Customer Manager',
    'seller': 'Seller',
    'merchant': 'Merchant',
    'customer': 'Customer'
  };
  return roleMap[role] || role;
}

// 辅助函数：获取角色颜色
function getRoleColor(role) {
  const colorMap = {
    'eventManager': '#667eea',
    'event_manager': '#667eea',
    'sellerManager': '#10b981',
    'seller_manager': '#10b981',
    'merchantManager': '#f59e0b',
    'merchant_manager': '#f59e0b',
    'customerManager': '#ec4899',
    'customer_manager': '#ec4899',
    'seller': '#06b6d4',
    'merchant': '#84cc16',
    'customer': '#8b5cf6'
  };
  const hexColor = colorMap[role] || '#667eea';
  // 转换为浅色背景
  return hexColor + '20';
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '2rem'
  },
  loadingCard: {
    background: 'white',
    padding: '3rem',
    borderRadius: '16px',
    textAlign: 'center',
    maxWidth: '400px',
    margin: '0 auto'
  },
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #667eea',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    margin: '0 auto 1rem',
    animation: 'spin 1s linear infinite'
  },
  header: {
    background: 'white',
    padding: '2rem',
    borderRadius: '16px',
    marginBottom: '2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    color: '#6b7280',
    margin: 0,
    fontSize: '1.1rem'
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
    color: '#374151',
    fontWeight: '500'
  },
  logoutButton: {
    padding: '0.75rem 1.5rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500'
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
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    borderTop: '4px solid',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  statIcon: {
    fontSize: '2.5rem'
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  infoSection: {
    background: 'white',
    padding: '2rem',
    borderRadius: '16px',
    marginBottom: '2rem',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '1.5rem'
  },
  sectionDescription: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '1rem',
    marginTop: '-0.5rem'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '1.5rem'
  },
  infoItem: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '8px'
  },
  infoIcon: {
    fontSize: '2rem'
  },
  infoLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  infoValue: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  actionsSection: {
    background: 'white',
    padding: '2rem',
    borderRadius: '16px',
    marginBottom: '2rem',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem'
  },
  actionCard: {
    position: 'relative',
    padding: '1.5rem',
    background: '#f9fafb',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '2px solid transparent'
  },
  actionIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '2rem',
    marginBottom: '1rem'
  },
  actionBadge: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    color: 'white',
    fontWeight: '600'
  },
  actionTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.5rem'
  },
  actionDescription: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0,
    marginBottom: '0.5rem'
  },
  actionArrow: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    transition: 'transform 0.2s'
  },
  quickActionsBar: {
    background: 'white',
    padding: '1rem 1.5rem',
    borderRadius: '12px',
    marginBottom: '2rem',
    display: 'flex',
    gap: '1rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  primaryButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'transform 0.2s'
  },
  secondaryButton: {
    padding: '0.75rem 1.5rem',
    background: 'white',
    color: '#667eea',
    border: '2px solid #667eea',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s'
  },
  // 表格相关样式
  tableSection: {
    background: 'white',
    borderRadius: '16px',
    marginBottom: '2rem',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    overflow: 'hidden'
  },
  tableHeader: {
    padding: '2rem',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
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
  tableCell: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.875rem',
    color: '#1f2937',
    borderRight: '1px solid #e5e7eb'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background-color 0.2s'
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  roleContainer: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  roleBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'white'
  },
  emptyState: {
    padding: '4rem 2rem',
    textAlign: 'center',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '3rem',
    marginBottom: '1rem'
  },
  emptyText: {
    fontSize: '1rem',
    margin: 0
  }
};

export default EventManagerDashboard;
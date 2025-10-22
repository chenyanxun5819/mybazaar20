import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';

// 在 import 之后添加
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  [data-action-card]:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0,0,0,0.15);
    border-color: currentColor;
  }
  
  [data-action-card]:hover [data-arrow] {
    transform: translateX(4px);
  }
`;
document.head.appendChild(styleSheet);

const EventManagerDashboard = () => {
  const { orgEventCode } = useParams(); // 例如：fch-2025
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [statistics, setStatistics] = useState({
    totalUsers: 0,
    totalSellerManagers: 0,
    totalMerchantManagers: 0,
    totalCustomerManagers: 0,
    totalCustomers: 0,
    totalSellers: 0,
    totalMerchants: 0
  });

  useEffect(() => {
    loadDashboardData();
  }, []);
  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // 从 localStorage 获取用户信息
      const storedInfo = localStorage.getItem('eventManagerInfo');
      if (!storedInfo) {
        alert('请先登录');
        navigate('/event-manager/login');
        return;
      }

      const info = JSON.parse(storedInfo);
      setUserInfo(info);

      // 读取 organization 主档
      const orgDocRef = doc(db, 'organizations', info.organizationId);
      const orgSnapshot = await getDoc(orgDocRef);
      const org = orgSnapshot.exists() ? orgSnapshot.data() : null;
      if (org) setOrgData(org);

      // 先尝试用 subcollection 的 event document：organizations/{orgId}/events/{eventId}
      const eventDocRef = doc(db, 'organizations', info.organizationId, 'events', info.eventId);
      const eventSnapshot = await getDoc(eventDocRef);

      let eventInfo = null;
      let stats = {
        totalUsers: 0,
        totalCustomers: 0,
        totalSellers: 0,
        totalMerchants: 0
      };

      if (eventSnapshot.exists()) {
        // case A: events is a subcollection
        eventInfo = eventSnapshot.data();
        // 加载用户统计（users 为 subcollection）
        const usersSnapshot = await getDocs(
          collection(db, 'organizations', info.organizationId, 'events', info.eventId, 'users')
        );

        stats.totalUsers = usersSnapshot.size;
        usersSnapshot.forEach(uDoc => {
          const userData = uDoc.data();
          if (userData.roles?.includes('customer')) stats.totalCustomers++;
          if (userData.roles?.includes('seller')) stats.totalSellers++;
          if (userData.roles?.includes('merchant')) stats.totalMerchants++;
        });
      } else if (org && org.events && org.events[info.eventId]) {
        // case B: events 是嵌在 organization document 的 map
        eventInfo = org.events[info.eventId];

        // users 可能為 nested object map
        const usersMap = eventInfo.users || {};
        const userEntries = Object.values(usersMap || {});
        stats.totalUsers = userEntries.length;
        userEntries.forEach(userData => {
          const roles = userData.roles || [];
          if (roles.includes('customer')) stats.totalCustomers++;
          if (roles.includes('seller')) stats.totalSellers++;
          if (roles.includes('merchant')) stats.totalMerchants++;
        });
      } else {
        // 未找到活动：保留 eventInfo 为 null（可在 UI 上处理）
        console.warn('[Dashboard] Event not found as subcollection nor nested map', {
          organizationId: info.organizationId,
          eventId: info.eventId
        });
      }

      if (eventInfo) {
        setEventData(eventInfo);
        setStatistics(stats);
      }
    } catch (error) {
      console.error('[Dashboard] Error loading data:', error);
      alert('加载数据失败: ' + (error?.message || error));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
      try {
        await signOut(auth);
        localStorage.removeItem('eventManagerInfo');
        navigate('/event-manager/login');
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
          value={statistics.totalSellerManagers || 0} // 🆕 修改
          icon="💰"
          color="#10b981"
        />
        <StatCard
          title="Merchant Managers"
          value={statistics.totalMerchantManagers || 0} // 🆕 修改
          icon="🏪"
          color="#f59e0b"
        />
        <StatCard
          title="Customer Managers"
          value={statistics.totalCustomerManagers || 0} // 🆕 修改
          icon="🎫"
          color="#ec4899"
        />
        <StatCard
          title="顾客"
          value={statistics.totalCustomers}
          icon="🛒"
          color="#10b981"
        />
        <StatCard
          title="销售员"
          value={statistics.totalSellers}
          icon="💰"
          color="#f59e0b"
        />
        <StatCard
          title="商家"
          value={statistics.totalMerchants}
          icon="🏪"
          color="#ec4899"
        />
      </div>

      {/* Event Info */}
      <div style={styles.infoSection}>
        <h2 style={styles.sectionTitle}>活动信息</h2>
        <div style={styles.infoGrid}>
          <InfoItem
            label="义卖会日期"
            value={eventData?.eventInfo?.fairDate || '未设定'}
            icon="📅"
          />
          <InfoItem
            label="义卖会时间"
            value={eventData?.eventInfo?.fairTime || '未设定'}
            icon="⏰"
          />
          <InfoItem
            label="消费有效期"
            value={
              eventData?.eventInfo?.consumptionPeriod
                ? `${eventData.eventInfo.consumptionPeriod.startDate} ~ ${eventData.eventInfo.consumptionPeriod.endDate}`
                : '未设定'
            }
            icon="💳"
          />
          <InfoItem
            label="活动地点"
            value={eventData?.eventInfo?.location || '未设定'}
            icon="📍"
          />
          <InfoItem
            label="总资本"
            value={`RM ${eventData?.settings?.totalCapital?.toLocaleString() || 0}`}
            icon="💵"
          />
          <InfoItem
            label="活动状态"
            value={eventData?.status === 'active' ? '进行中' : eventData?.status === 'planning' ? '筹备中' : '未知'}
            icon="📊"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div style={styles.actionsSection}>
        <h2 style={styles.sectionTitle}>管理团队</h2>
        <p style={styles.sectionDescription}>
          创建和管理活动的三类管理员
        </p>
        <div style={styles.actionsGrid}>
          <ActionCard
            title="Seller Manager"
            description="管理销售团队，分配和回收资本"
            icon="💰"
            badge="销售管理"
            onClick={() => alert('Seller Manager 功能开发中')}
            color="#667eea"
          />
          <ActionCard
            title="Merchant Manager"
            description="管理商家，印制 QR Code"
            icon="🏪"
            badge="商家管理"
            onClick={() => alert('Merchant Manager 功能开发中')}
            color="#10b981"
          />
          <ActionCard
            title="Customer Manager"
            description="义卖会当日销售和收款"
            icon="🎫"
            badge="顾客管理"
            onClick={() => alert('Customer Manager 功能开发中')}
            color="#f59e0b"
          />
        </div>
      </div>

      {/* Capital Management */}
      <div style={styles.actionsSection}>
        <h2 style={styles.sectionTitle}>资本管理</h2>
        <div style={styles.actionsGrid}>
          <ActionCard
            title="分配资本"
            description="分配资本给 Seller Manager"
            icon="💵"
            onClick={() => alert('资本分配功能开发中')}
            color="#ec4899"
          />
          <ActionCard
            title="资本统计"
            description="查看资本分配和使用情况"
            icon="📊"
            onClick={() => alert('统计功能开发中')}
            color="#8b5cf6"
          />
        </div>
      </div>

      {/* System Management */}
      <div style={styles.actionsSection}>
        <h2 style={styles.sectionTitle}>系统管理</h2>
        <div style={styles.actionsGrid}>
          <ActionCard
            title="活动设置"
            description="修改活动配置和信息"
            icon="⚙️"
            onClick={() => alert('活动设置功能开发中')}
            color="#06b6d4"
          />
          <ActionCard
            title="系统日志"
            description="查看操作记录和审计日志"
            icon="📝"
            onClick={() => alert('系统日志功能开发中')}
            color="#64748b"
          />
        </div>
      </div>
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
  <div style={styles.actionCard} onClick={onClick} data-action-card>
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
    <div style={{ ...styles.actionArrow, color }} data-arrow>→</div>
  </div>
);

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
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem'
  },
  actionCard: {
    padding: '1.5rem',
    background: '#f9fafb',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
    ':hover': {
      transform: 'translateY(-4px)',
      boxShadow: '0 6px 12px rgba(0,0,0,0.1)'
    }
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
  actionTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.5rem'
  },
  actionDescription: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  },
  // 🆕 新增样式
  sectionDescription: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '1rem',
    marginTop: '-0.5rem'
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
  actionArrow: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginTop: '0.5rem',
    transition: 'transform 0.2s'
  },
  actionCard: {
    position: 'relative', // 🆕 添加这个
    padding: '1.5rem',
    background: '#f9fafb',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '2px solid transparent'
  }
};

export default EventManagerDashboard;
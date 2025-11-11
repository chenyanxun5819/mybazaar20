import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { 
  doc, 
  getDoc, 
  collection, 
  getDocs,
  query,
  where,
  orderBy 
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import AddUser from '../../components/common/AddUser';
import AllocatePoints from './components/AllocatePoints';
import SellerList from './components/SellerList';

/**
 * Seller Manager Dashboard
 * 
 * @description
 * Seller Manager（班级老师）的主控制台
 * 功能：
 * 1. 查看分配的资本统计
 * 2. 创建 Seller（学生）
 * 3. 分配固本给 Seller
 * 4. 查看和管理所有 Sellers
 * 
 * @route /seller-manager/:orgEventCode/dashboard
 */
const SellerManagerDashboard = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  
  // 基础数据状态
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [sellerManagerData, setSellerManagerData] = useState(null);
  
  // Sellers 数据
  const [sellers, setSellers] = useState([]);
  const [loadingSellers, setLoadingSellers] = useState(false);
  
  // UI 状态
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAllocatePoints, setShowAllocatePoints] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState(null);
  
  // 统计数据
  const [statistics, setStatistics] = useState({
    assignedCapital: 0,      // 分配的总资本
    availableCapital: 0,     // 可用资本
    allocatedToSellers: 0,   // 已分配给 Sellers
    totalSellersManaged: 0   // 管理的 Sellers 数量
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  useEffect(() => {
    if (userInfo) {
      loadSellers();
    }
  }, [userInfo]);

  /**
   * 加载 Dashboard 数据
   */
  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // 🔐 从 localStorage 获取登录信息
      const storedInfo = localStorage.getItem('sellerManagerInfo');
      if (!storedInfo) {
        console.warn('[Dashboard] 未找到登录信息，跳转到登录页');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      const info = JSON.parse(storedInfo);
      console.log('[Dashboard] 加载用户信息:', info);
      
      // 验证角色（驼峰式）
      if (!info.roles?.includes('sellerManager')) {
        alert('您没有 Seller Manager 权限');
        navigate(`/login/${orgEventCode}`);
        return;
      }
      
      setUserInfo(info);

      // 📋 加载组织信息
      const orgDoc = await getDoc(doc(db, 'organizations', info.organizationId));
      if (orgDoc.exists()) {
        setOrgData(orgDoc.data());
        console.log('[Dashboard] 组织数据加载成功');
      }

      // 📋 加载活动信息
      const eventDoc = await getDoc(
        doc(db, 'organizations', info.organizationId, 'events', info.eventId)
      );
      if (eventDoc.exists()) {
        setEventData(eventDoc.data());
        console.log('[Dashboard] 活动数据加载成功');
      }

      // 📋 加载 Seller Manager 的用户数据
      const userDoc = await getDoc(
        doc(db, 'organizations', info.organizationId, 'events', info.eventId, 'users', info.userId)
      );
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setSellerManagerData(userData);
        
        // 提取 Seller Manager 的统计数据
        const smData = userData.roleSpecificData?.seller_manager || {};
        setStatistics({
          assignedCapital: smData.assignedCapital || 0,
          availableCapital: smData.availableCapital || 0,
          allocatedToSellers: smData.allocatedToSellers || 0,
          totalSellersManaged: smData.totalSellersManaged || 0
        });
        
        console.log('[Dashboard] Seller Manager 数据加载成功:', smData);
      }

    } catch (error) {
      console.error('[Dashboard] 加载数据失败:', error);
      alert('加载数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加载所有属于当前 Seller Manager 的 Sellers
   */
  const loadSellers = async () => {
    try {
      setLoadingSellers(true);
      console.log('[Dashboard] 加载 Sellers 列表...');

      const usersRef = collection(
        db,
        'organizations', userInfo.organizationId,
        'events', userInfo.eventId,
        'users'
      );

      // 🔍 查询条件：
      // 1. 包含 'seller' 角色
      // 2. managedBy 等于当前 Seller Manager 的 userId
      const q = query(
        usersRef,
        where('roles', 'array-contains', 'seller'),
        orderBy('accountStatus.createdAt', 'desc')
      );

      const snapshot = await getDocs(q);
      
      // 过滤出由当前 SM 管理的 Sellers
      const sellersList = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(user => 
          user.roleSpecificData?.seller?.managedBy === userInfo.userId
        );

      setSellers(sellersList);
      console.log('[Dashboard] Sellers 加载成功:', sellersList.length);

    } catch (error) {
      console.error('[Dashboard] 加载 Sellers 失败:', error);
      alert('加载 Sellers 失败: ' + error.message);
    } finally {
      setLoadingSellers(false);
    }
  };

  /**
   * 处理登出
   */
  const handleLogout = async () => {
    if (confirm('确定要退出登录吗？')) {
      try {
        await signOut(auth);
        localStorage.removeItem('sellerManagerInfo');
        navigate(`/login/${orgEventCode}`);
      } catch (error) {
        console.error('[Dashboard] 登出失败:', error);
        alert('退出登录失败');
      }
    }
  };

  /**
   * 打开分配固本弹窗
   */
  const handleAllocatePoints = (seller) => {
    setSelectedSeller(seller);
    setShowAllocatePoints(true);
  };

  /**
   * 刷新数据（在创建用户或分配固本后调用）
   */
  const handleRefresh = () => {
    loadDashboardData();
    loadSellers();
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
            💰 Seller Manager Dashboard
          </h1>
          <p style={styles.subtitle}>
            {orgData?.orgName?.['zh-CN'] || '组织'} - {eventData?.eventName?.['zh-CN'] || '活动'}
          </p>
          <p style={styles.roleLabel}>班级老师管理系统</p>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>
              👤 {sellerManagerData?.basicInfo?.englishName || '用户'}
            </span>
          </div>
          <button style={styles.logoutButton} onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </div>

      {/* 📊 Statistics Cards */}
      <div style={styles.statsGrid}>
        <StatCard
          title="分配资本"
          value={`RM ${statistics.assignedCapital.toLocaleString()}`}
          icon="💵"
          color="#667eea"
          description="Event Manager 分配的总资本"
        />
        <StatCard
          title="可用资本"
          value={`RM ${statistics.availableCapital.toLocaleString()}`}
          icon="💰"
          color="#10b981"
          description="可以分配给学生的资本"
        />
        <StatCard
          title="已分配"
          value={`RM ${statistics.allocatedToSellers.toLocaleString()}`}
          icon="📤"
          color="#f59e0b"
          description="已分配给学生的固本"
        />
        <StatCard
          title="管理学生"
          value={statistics.totalSellersManaged}
          icon="👥"
          color="#ec4899"
          description="总共管理的学生数量"
        />
      </div>

      {/* Quick Actions Bar */}
      <div style={styles.quickActionsBar}>
        <button
          style={styles.primaryButton}
          onClick={() => setShowAddUser(true)}
          disabled={statistics.availableCapital <= 0}
        >
          ➕ 创建 Seller（学生）
        </button>
        <button
          style={styles.secondaryButton}
          onClick={handleRefresh}
        >
          🔄 刷新数据
        </button>
      </div>

      {/* 资本不足提示 */}
      {statistics.availableCapital <= 0 && (
        <div style={styles.warningBox}>
          ⚠️ 您的可用资本不足，无法创建新的 Seller。请联系 Event Manager 申请更多资本。
        </div>
      )}

      {/* 💡 使用提示 */}
      <div style={styles.infoBox}>
        <h3 style={styles.infoTitle}>💡 使用指南</h3>
        <ul style={styles.infoList}>
          <li>点击 "创建 Seller" 添加学生账户</li>
          <li>在学生列表中点击 "分配固本" 给学生分配销售资本</li>
          <li>学生可以使用分配的固本向家长销售</li>
          <li>您可以随时查看每个学生的销售情况</li>
        </ul>
      </div>

      {/* 📋 Sellers List */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>
            👥 我的 Sellers（学生）
          </h2>
          <span style={styles.badge}>
            {sellers.length} 位学生
          </span>
        </div>

        {loadingSellers ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={styles.spinner}></div>
            <p>加载学生列表中...</p>
          </div>
        ) : sellers.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📝</div>
            <h3>还没有 Seller</h3>
            <p>点击上方 "创建 Seller" 按钮添加您的第一位学生</p>
          </div>
        ) : (
          <SellerList
            sellers={sellers}
            onAllocatePoints={handleAllocatePoints}
            onRefresh={handleRefresh}
          />
        )}
      </div>

      {/* 🎭 Modals */}
      {showAddUser && (
        <AddUser
          organizationId={userInfo.organizationId}
          eventId={userInfo.eventId}
          callerRole="seller_manager"  // 🔑 关键：限制只能创建 Seller
          onClose={() => setShowAddUser(false)}
          onSuccess={() => {
            setShowAddUser(false);
            handleRefresh();
          }}
        />
      )}

      {showAllocatePoints && selectedSeller && (
        <AllocatePoints
          seller={selectedSeller}
          sellerManager={userInfo}
          availableCapital={statistics.availableCapital}
          organizationId={userInfo.organizationId}
          eventId={userInfo.eventId}
          onClose={() => {
            setShowAllocatePoints(false);
            setSelectedSeller(null);
          }}
          onSuccess={() => {
            setShowAllocatePoints(false);
            setSelectedSeller(null);
            handleRefresh();
          }}
        />
      )}
    </div>
  );
};

// 📊 Statistics Card Component
const StatCard = ({ title, value, icon, color, description }) => (
  <div style={{ ...styles.statCard, borderTopColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
      {description && (
        <div style={styles.statDescription}>{description}</div>
      )}
    </div>
  </div>
);

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
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
    border: '4px solid #f59e0b',
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
    margin: '0 0 0.25rem 0',
    fontSize: '1.1rem'
  },
  roleLabel: {
    color: '#f59e0b',
    margin: 0,
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  headerActions: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center'
  },
  userInfo: {
    padding: '0.5rem 1rem',
    background: '#fef3c7',
    borderRadius: '8px'
  },
  userName: {
    color: '#92400e',
    fontWeight: '500'
  },
  logoutButton: {
    padding: '0.75rem 1.5rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background 0.2s'
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
    alignItems: 'flex-start',
    gap: '1rem',
    borderTop: '4px solid',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s',
    cursor: 'default'
  },
  statIcon: {
    fontSize: '2.5rem',
    lineHeight: 1
  },
  statContent: {
    flex: 1
  },
  statValue: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '600'
  },
  statDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
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
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  secondaryButton: {
    padding: '0.75rem 1.5rem',
    background: 'white',
    color: '#f59e0b',
    border: '2px solid #f59e0b',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  warningBox: {
    background: '#fef3c7',
    border: '2px solid #fbbf24',
    color: '#92400e',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '2rem',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  infoBox: {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '2rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  infoTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '1rem',
    marginTop: 0
  },
  infoList: {
    margin: 0,
    paddingLeft: '1.5rem',
    color: '#6b7280',
    fontSize: '0.875rem',
    lineHeight: '1.8'
  },
  section: {
    background: 'white',
    padding: '2rem',
    borderRadius: '16px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem'
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  badge: {
    background: '#fef3c7',
    color: '#92400e',
    padding: '0.5rem 1rem',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem 1rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  }
};

// 添加旋转动画
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default SellerManagerDashboard;
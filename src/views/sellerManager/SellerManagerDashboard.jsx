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
import RoleSwitcher from '../../components/common/RoleSwitcher'; // 🆕 角色切换器

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
      
      // 验证角色（检查 availableRoles，这是已转换为驼峰式的）
      if (!info.availableRoles?.includes('sellerManager')) {
        console.warn('[Dashboard] 没有 Seller Manager 权限，availableRoles:', info.availableRoles);
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

      // 📋 加载 Seller Manager 用户文档
      const userDoc = await getDoc(
        doc(db, 'organizations', info.organizationId, 'events', info.eventId, 'users', info.userId)
      );
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setSellerManagerData(userData);
        
        // 🎯 计算统计数据
        const capital = userData.capital || {};
        const stats = {
          assignedCapital: capital.assignedCapital || 0,
          availableCapital: capital.availableCapital || 0,
          allocatedToSellers: capital.allocatedToSellers || 0,
          totalSellersManaged: 0 // 稍后从 sellers 加载
        };
        setStatistics(stats);
        
        console.log('[Dashboard] Seller Manager 数据加载成功:', {
          capital: stats
        });
      }

    } catch (error) {
      console.error('[Dashboard] 加载失败:', error);
      alert(`加载失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加载该 Seller Manager 管理的所有 Sellers
   */
  const loadSellers = async () => {
    try {
      setLoadingSellers(true);
      console.log('[Dashboard] 开始加载 Sellers...');

      const usersRef = collection(
        db, 
        'organizations', 
        userInfo.organizationId, 
        'events', 
        userInfo.eventId, 
        'users'
      );

      let sellersList = [];

      try {
        // 🔍 策略1：尝试使用复合查询（需要 Firestore 索引）
        console.log('[Dashboard] 尝试复合查询 (roles + managedBy + orderBy)...');
        const q = query(
          usersRef,
          where('roles', 'array-contains', 'seller'),
          where('managedBy', '==', userInfo.userId),
          orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
          sellersList.push({
            id: doc.id,
            ...doc.data()
          });
        });

        console.log('[Dashboard] ✅ 复合查询成功，Sellers:', sellersList.length);

      } catch (indexError) {
        console.warn('[Dashboard] ⚠️ 复合查询失败，尝试备选方案 1...');
        
        try {
          // 🔍 策略2：查询 managedBy，再在内存中过滤 seller 角色
          console.log('[Dashboard] 尝试查询 (managedBy only)...');
          const q = query(
            usersRef,
            where('managedBy', '==', userInfo.userId)
          );

          const snapshot = await getDocs(q);
          const tempList = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            tempList.push({
              id: doc.id,
              ...data
            });
          });

          // 在内存中过滤出 seller 角色，并按 createdAt 排序
          sellersList = tempList
            .filter(item => item.roles?.includes('seller'))
            .sort((a, b) => {
              const timeA = a.createdAt?.getTime?.() || 0;
              const timeB = b.createdAt?.getTime?.() || 0;
              return timeB - timeA;
            });

          console.log('[Dashboard] ✅ 备选方案 1 成功，Sellers:', sellersList.length);

        } catch (fallback1Error) {
          console.warn('[Dashboard] ⚠️ 备选方案 1 失败，尝试备选方案 2...');
          
          try {
            // 🔍 策略3：获取所有用户，在内存中过滤（最后的手段）
            console.log('[Dashboard] 尝试查询所有用户并在内存过滤...');
            const snapshot = await getDocs(usersRef);
            const tempList = [];
            snapshot.forEach(doc => {
              const data = doc.data();
              tempList.push({
                id: doc.id,
                ...data
              });
            });

            // 在内存中过滤：seller 角色 + 由当前 Seller Manager 管理
            sellersList = tempList
              .filter(item => 
                item.roles?.includes('seller') && 
                item.managedBy === userInfo.userId
              )
              .sort((a, b) => {
                const timeA = a.createdAt?.getTime?.() || 0;
                const timeB = b.createdAt?.getTime?.() || 0;
                return timeB - timeA;
              });

            console.log('[Dashboard] ✅ 备选方案 2 成功，Sellers:', sellersList.length);

          } catch (fallback2Error) {
            console.error('[Dashboard] ❌ 所有查询方案都失败:', fallback2Error.message);
            alert('加载 Sellers 失败，请稍后重试');
            throw fallback2Error;
          }
        }
      }

      setSellers(sellersList);
      
      // 更新统计中的 Sellers 数量
      setStatistics(prev => ({
        ...prev,
        totalSellersManaged: sellersList.length
      }));

      console.log('[Dashboard] ✅ Sellers 加载成功:', sellersList.length);

    } catch (error) {
      console.error('[Dashboard] ❌ 加载 Sellers 失败:', error);
      setSellers([]);
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
      {/* Header with Role Switcher */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div>
            <h1 style={styles.title}>
              💰 Seller Manager Dashboard
            </h1>
            <p style={styles.subtitle}>
              {orgData?.orgName?.['zh-CN'] || '组织'} - {eventData?.eventName?.['zh-CN'] || '活动'}
            </p>
            <p style={styles.roleLabel}>班级老师管理系统</p>
          </div>
          {/* 🆕 角色切换器 */}
          {userInfo?.availableRoles && userInfo.availableRoles.length > 1 && (
            <div style={styles.roleSwitcherWrapper}>
              <RoleSwitcher
                currentRole={userInfo.currentRole || 'sellerManager'}
                availableRoles={userInfo.availableRoles}
                orgEventCode={orgEventCode}
                userInfo={userInfo}
              />
            </div>
          )}
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
          icon="🛍️"
          color="#ec4899"
          description="您管理的学生 (Sellers)"
        />
      </div>

      {/* 🚀 Quick Actions */}
      <div style={styles.actionsBar}>
        <button 
          style={styles.primaryButton}
          onClick={() => setShowAddUser(true)}
        >
          ➕ 创建新学生 (Seller)
        </button>
        <button 
          style={styles.secondaryButton}
          onClick={handleRefresh}
          disabled={loadingSellers}
        >
          🔄 刷新数据
        </button>
      </div>

      {/* 📋 Sellers List */}
      <div style={styles.sellersSection}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>
            我管理的学生 (Sellers)
          </h2>
          <div style={styles.sellerCount}>
            共 <strong>{sellers.length}</strong> 个学生
          </div>
        </div>

        {loadingSellers ? (
          <div style={styles.loadingCard}>
            <div style={styles.spinner}></div>
            <p>加载学生列表...</p>
          </div>
        ) : sellers.length > 0 ? (
          <SellerList
            sellers={sellers}
            onAllocatePoints={handleAllocatePoints}
            onRefresh={handleRefresh}
          />
        ) : (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>🛍️</div>
            <p style={styles.emptyText}>还没有创建任何学生</p>
            <button 
              style={styles.primaryButton}
              onClick={() => setShowAddUser(true)}
            >
              创建第一个学生
            </button>
          </div>
        )}
      </div>

      {/* 🎭 Modals */}
      {showAddUser && (
        <AddUser
          organizationId={userInfo.organizationId}
          eventId={userInfo.eventId}
          onClose={() => {
            setShowAddUser(false);
            handleRefresh();
          }}
          currentUserRole="sellerManager"
          managedBy={userInfo.userId}
          presetRoles={['seller']}
          departmentId={sellerManagerData?.departmentInfo?.departmentId}
        />
      )}

      {showAllocatePoints && selectedSeller && (
        <AllocatePoints
          seller={selectedSeller}
          sellerManager={sellerManagerData}
          organizationId={userInfo.organizationId}
          eventId={userInfo.eventId}
          onClose={() => {
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
  <div style={{ ...styles.statCard, borderLeftColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{title}</div>
      {description && (
        <div style={styles.statDescription}>{description}</div>
      )}
    </div>
  </div>
);

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '2rem'
  },
  loadingCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  spinner: {
    width: '3rem',
    height: '3rem',
    border: '4px solid #e5e7eb',
    borderTopColor: '#667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
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
    margin: '0 0 0.25rem 0',
    fontSize: '0.95rem'
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
    alignItems: 'flex-start',
    gap: '1rem',
    borderLeft: '4px solid'
  },
  statIcon: {
    fontSize: '2.5rem'
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
  statLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '600',
    marginBottom: '0.25rem'
  },
  statDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  actionsBar: {
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
  sellersSection: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    padding: '1.5rem'
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
  sellerCount: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  emptyText: {
    fontSize: '1rem',
    marginBottom: '1.5rem'
  }
};

// 🎨 CSS Animation for spinner
const styleSheet = document.styleSheets[0];
styleSheet.insertRule(`
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`, styleSheet.cssRules.length);

export default SellerManagerDashboard;
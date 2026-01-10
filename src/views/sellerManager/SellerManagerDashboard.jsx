import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db, BUILD_TIMESTAMP } from '../../config/firebase';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext'; // 🆕 Use AuthContext
import AllocatePoints from './components/AllocatePoints';
import SellerList from './components/SellerList';
import OverviewStats from './components/OverviewStats';
import SubmitCash from './components/SubmitCash';
import CollectCash from './components/CollectCash';

/**
 * Seller Manager Dashboard (完整版 v2.0)
 * ✅ 更新：添加"上交现金" Tab
 * 
 * Tabs:
 * 1. overview - 总览统计
 * 2. allocate - 分配点数
 * 3. collect - 收取现金
 * 4. submit - 上交现金 (🆕 新增)
 * 5. sellers - Sellers管理
 */

// 全域輔助：根據活動資料取得每次最高可分配點數（提供穩定 fallback）
const resolveMaxPerAllocation = (eventData) => {
  if (!eventData || typeof eventData !== 'object') return 100;
  try {
    const rule = eventData.pointAllocationRules?.sellerManager;
    if (rule && typeof rule.maxPerAllocation === 'number') return rule.maxPerAllocation;
    return 100;
  } catch { return 100; }
};

// 全域輔助：警示門檻
const resolveWarningThreshold = (eventData) => {
  if (!eventData || typeof eventData !== 'object') return 0.3;
  try {
    const rule = eventData.pointAllocationRules?.sellerManager;
    if (rule && typeof rule.warningThreshold === 'number') return rule.warningThreshold;
    return 0.3;
  } catch { return 0.3; }
};

// 將可能的本地化物件轉為字串（優先 zh-TW/zh-CN，其次 en）
const getLocalizedText = (val) => {
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    return val['zh-TW'] || val['zh-CN'] || val['en'] || val['zh'] || val['cn'] || '';
  }
  return '';
};

const SellerManagerDashboard = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  const { userProfile, loading: authLoading } = useAuth(); // 🆕 Use AuthContext

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [eventId, setEventId] = useState(null);

  const [smStats, setSmStats] = useState(null);
  const [departmentStats, setDepartmentStats] = useState([]);
  const [managedUsersStats, setManagedUsersStats] = useState(null);

  const [sellers, setSellers] = useState([]);
  const [loadingSellers, setLoadingSellers] = useState(false);

  const [showAllocatePoints, setShowAllocatePoints] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState(null);

  // 标签页管理
  const [activeTab, setActiveTab] = useState('overview');

  // 🆕 初始化逻辑 (基于 AuthContext)
  useEffect(() => {
    if (authLoading) return;

    const init = async () => {
      try {
        setLoading(true);

        if (!userProfile) {
          console.warn('[SM Dashboard] 未找到登录信息');
          // 如果没有 userProfile，尝试从 localStorage 恢复 (兼容旧逻辑)
          const storedInfo = localStorage.getItem('sellerManagerInfo');
          if (storedInfo) {
            // 如果有旧的 localStorage，可能需要重新登录刷新
            console.warn('[SM Dashboard] 发现旧的 localStorage，建议重新登录');
          }
          navigate(`/login/${orgEventCode}`);
          return;
        }

        console.log('[SM Dashboard] 用户信息 (AuthContext):', userProfile);

        if (!userProfile.roles || !userProfile.roles.includes('sellerManager')) {
          alert('您没有 Seller Manager 权限');
          navigate(`/login/${orgEventCode}`);
          return;
        }

        // 🆕 健壮的部门检查逻辑
        // 优先检查 sellerManager.managedDepartments，其次检查根目录 managedDepartments
        const managedDepts = userProfile.sellerManager?.managedDepartments || userProfile.managedDepartments || [];

        if (!Array.isArray(managedDepts) || managedDepts.length === 0) {
          console.warn('[SM Dashboard] ⚠️ 注意：您还没有被分配管理任何部门');
          // alert('您还没有被分配管理任何部门'); // 🚫 移除阻塞性 Alert，允许进入 Dashboard 查看空状态
        }

        // 构建兼容的 userInfo 对象
        const userInfo = {
          ...userProfile,
          managedDepartments: managedDepts
        };

        setCurrentUser(userInfo);
        setEventId(userProfile.eventId);

        // 加载活动信息
        const eventDoc = await getDoc(
          doc(db, 'organizations', userProfile.organizationId, 'events', userProfile.eventId)
        );

        if (eventDoc.exists()) {
          const data = eventDoc.data();
          setEventData(data || {});
          console.log('[SM Dashboard] 活动数据加载成功');
        }
      } catch (error) {
        console.error('[SM Dashboard] 初始化失败:', error);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [userProfile, authLoading, orgEventCode, navigate]);

  useEffect(() => {
    let unsubscribeStats = null;
    let unsubscribeSellers = null;

    if (currentUser && eventId) {
      unsubscribeSellers = loadSellers();
    }

    return () => {
      if (typeof unsubscribeStats === 'function') unsubscribeStats();
      if (typeof unsubscribeSellers === 'function') unsubscribeSellers();
    };
  }, [currentUser, eventId]);

  // 🚫 移除旧的 initializeDashboard 函数
  /*
  const initializeDashboard = async () => {
    // ... legacy code ...
  };
  */


  const loadSellers = () => {
    if (!currentUser || !eventId) return;

    try {
      setLoadingSellers(true);

      if (!Array.isArray(currentUser.managedDepartments) || currentUser.managedDepartments.length === 0) {
        console.warn('⚠️ 没有管理的部门');
        setSellers([]);
        setLoadingSellers(false);
        return;
      }

      console.log(`📊 开始加载 Sellers，管理 ${currentUser.managedDepartments.length} 个部门:`, currentUser.managedDepartments);

      // ✅ 只使用 array-contains 查询
      const q = query(
        collection(db, 'organizations', currentUser.organizationId, 'events', eventId, 'users'),
        where('roles', 'array-contains', 'seller')
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list = [];
          let totalCount = 0;

          snapshot.forEach(doc => {
            totalCount++;
            const data = doc.data() || {};

            // ✅ 客户端过滤：只保留管理范围内的 sellers
            if (currentUser.managedDepartments &&
              data.identityInfo?.department &&
              currentUser.managedDepartments.includes(data.identityInfo.department)) {

              list.push({
                id: doc.id,
                userId: doc.id,
                ...data
              });
            }
          });

          // 排序：最新创建的在前
          list.sort((a, b) => {
            const timeA = (a.accountStatus?.createdAt?.toMillis) ? a.accountStatus.createdAt.toMillis() : 0;
            const timeB = (b.accountStatus?.createdAt?.toMillis) ? b.accountStatus.createdAt.toMillis() : 0;
            return timeB - timeA;
          });

          console.log(`✅ 加载完成: 读取 ${totalCount} 条，筛选出 ${list.length} 条 (过滤 ${totalCount - list.length} 条)`);

          setSellers(list);
          setLoadingSellers(false);

          // ✅ 聚合数据
          const aggregatedStats = aggregateManagedUsersStats(list);
          const aggregatedDepts = aggregateDepartmentStats(list);

          setManagedUsersStats(aggregatedStats);
          setDepartmentStats(aggregatedDepts);
        },
        (error) => {
          console.error('❌ 加载 Sellers 失败:', error);
          setSellers([]);
          setLoadingSellers(false);
        }
      );

      return unsubscribe;

    } catch (error) {
      console.error('❌ 加载 Sellers 异常:', error);
      setSellers([]);
      setLoadingSellers(false);
    }
  };




  /**
   * 聚合被管理的 Sellers 的统计数据
   */
  const aggregateManagedUsersStats = (sellersList) => {
    if (!Array.isArray(sellersList) || sellersList.length === 0) {
      return {
        totalUsers: 0,
        activeUsers: 0,
        currentBalance: 0,
        totalRevenue: 0,
        totalCollected: 0,
        pendingCollection: 0,
        collectionRate: 0
      };
    }

    let totalUsers = 0;
    let activeUsers = 0;
    let currentBalance = 0;
    let totalRevenue = 0;
    let totalCollected = 0;
    let pendingCollection = 0;
    let usersWithWarnings = 0;
    let highRiskUsers = 0;

    sellersList.forEach(seller => {
      const sellerData = seller.seller || {};

      totalUsers++;

      // ✅ 从 seller 对象读取数据
      const availablePoints = sellerData.availablePoints || 0;
      const totalSold = sellerData.totalPointsSold || 0;
      const totalCashCollected = sellerData.totalCashCollected || 0;

      if (totalSold > 0) {
        activeUsers++;
      }

      currentBalance += availablePoints;
      totalRevenue += (sellerData.totalRevenue || 0);
      totalCollected += totalCashCollected;
      pendingCollection += (sellerData.pendingCollection || 0);

      // 检查警示
      const collectionAlert = sellerData.collectionAlert || {};
      if (collectionAlert.hasWarning) {
        usersWithWarnings++;
        if (collectionAlert.warningLevel === 'high') {
          highRiskUsers++;
        }
      }
    });

    const collectionRate = totalRevenue > 0 ? totalCollected / totalRevenue : 0;

    return {
      totalUsers,
      activeUsers,
      currentBalance,
      totalRevenue,
      totalCollected,
      pendingCollection,
      collectionRate,
      usersWithWarnings,
      highRiskUsers
    };
  };

  /**
   * 聚合部门统计数据
   */
  const aggregateDepartmentStats = (sellersList) => {
    if (!Array.isArray(sellersList) || sellersList.length === 0) {
      return [];
    }

    const deptMap = {};

    sellersList.forEach(seller => {
      const deptCode = seller.identityInfo?.department;
      if (!deptCode) return;

      if (!deptMap[deptCode]) {
        deptMap[deptCode] = {
          departmentCode: deptCode,
          departmentName: seller.identityInfo?.departmentName || deptCode,
          totalCount: 0,
          activeCount: 0,
          currentBalance: 0,
          totalRevenue: 0,
          totalCollected: 0,
          pendingCollection: 0,
          usersWithWarnings: 0,
          highRiskUsers: 0
        };
      }

      const dept = deptMap[deptCode];
      const sellerData = seller.seller || {};

      dept.totalCount++;
      if ((sellerData.totalPointsSold || 0) > 0) {
        dept.activeCount++;
      }

      dept.currentBalance += (sellerData.availablePoints || 0);
      dept.totalRevenue += (sellerData.totalRevenue || 0);
      dept.totalCollected += (sellerData.totalCashCollected || 0);
      dept.pendingCollection += (sellerData.pendingCollection || 0);

      const collectionAlert = sellerData.collectionAlert || {};
      if (collectionAlert.hasWarning) {
        dept.usersWithWarnings++;
        if (collectionAlert.warningLevel === 'high') {
          dept.highRiskUsers++;
        }
      }
    });

    // 转为数组并计算收款率
    const deptArray = Object.values(deptMap).map(dept => ({
      ...dept,
      id: dept.departmentCode,
      membersStats: {
        totalCount: dept.totalCount,
        activeCount: dept.activeCount
      },
      pointsStats: {
        currentBalance: dept.currentBalance,
        totalRevenue: dept.totalRevenue,
        totalCollected: dept.totalCollected,
        pendingCollection: dept.pendingCollection,
        collectionRate: dept.totalRevenue > 0 ? dept.totalCollected / dept.totalRevenue : 0
      },
      collectionAlerts: {
        usersWithWarnings: dept.usersWithWarnings,
        highRiskUsers: dept.highRiskUsers > 0 ? [/* 这里可以添加具体用户ID */] : []
      }
    }));

    return deptArray;
  };

  const handleAllocatePoints = (seller) => {
    console.log('[SM Dashboard] 选择 Seller 进行分配:', seller);
    setSelectedSeller(seller);
    setShowAllocatePoints(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('sellerManagerInfo');
      localStorage.removeItem('currentUser');
      console.log('[SM Dashboard] 用户已登出');
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('[SM Dashboard] 登出失败:', error);
      alert('登出失败，请重试');
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

  const safeCurrentUser = currentUser || {};
  const safeEventData = eventData || {};
  const safeSellers = Array.isArray(sellers) ? sellers : [];
  const safeManagedUsersStats = managedUsersStats || {};
  const safeDepartmentStats = Array.isArray(departmentStats) ? departmentStats : [];

  const maxPerAllocation = resolveMaxPerAllocation(safeEventData);
  const warningThreshold = resolveWarningThreshold(safeEventData);

  const userName = safeCurrentUser.basicInfo?.chineseName || safeCurrentUser.basicInfo?.englishName || '未知用户';
  const eventName = getLocalizedText(safeEventData.eventName) || '活动名称';

  // ✅ 构建SM统计对象
  const smStatsForOverview = {
    managedUsersStats: safeManagedUsersStats,
    allocationStats: {
      totalAllocations: 0,
      totalPointsAllocated: 0,
      averagePerAllocation: 0
    },
    collectionManagement: {
      usersWithWarnings: safeManagedUsersStats.usersWithWarnings || 0,
      highRiskUsers: safeManagedUsersStats.highRiskUsers || 0
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div>
            <h1 style={styles.title}>Seller Manager 控制台</h1>
            <p style={styles.subtitle}>{eventName}</p>
            <p style={styles.roleLabel}>
              管理 {safeCurrentUser.managedDepartments?.length || 0} 个部门
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <div style={styles.userInfo}>
            <div style={styles.userName}>{userName}</div>
            <div style={styles.allocationLimit}>
              每次最高分配: RM {maxPerAllocation}
            </div>
          </div>
          <button style={styles.logoutButton} onClick={handleLogout}>
            登出
          </button>
          {BUILD_TIMESTAMP && (
            <div style={styles.versionBadge}>
              {BUILD_TIMESTAMP}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'overview' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('overview')}
        >
          📊 总览
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'allocate' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('allocate')}
        >
          📦 分配点数
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'collect' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('collect')}
        >
          💵 收取现金
        </button>
        {/* 🆕 新增Tab */}
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'submit' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('submit')}
        >
          📤 上交现金
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'sellers' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('sellers')}
        >
          👥 Sellers
        </button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'overview' && (
          <div style={styles.section}>
            <OverviewStats
              organizationId={safeCurrentUser.organizationId}              // ✅ 新增
              eventId={eventId}                                             // ✅ 新增
              sellerManagerId={safeCurrentUser.userId}                      // ✅ 新增
              managedDepartments={safeCurrentUser.managedDepartments || []} // ✅ 新增
              eventData={safeEventData}                                     // ✅ 保留
            />
          </div>
        )}

        {activeTab === 'allocate' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>📦 分配点数</h2>
              <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                选择 Seller 分配点数（每次最高 {maxPerAllocation} 点）
              </p>
            </div>

            {loadingSellers ? (
              <div style={styles.loadingCard}>
                <div style={styles.spinner}></div>
                <p>加载 Sellers...</p>
              </div>
            ) : (
              <SellerList
                sellers={safeSellers}
                selectedDepartment={null}
                onSelectSeller={handleAllocatePoints}
                eventId={eventId}
                orgId={safeCurrentUser.organizationId}
                currentUser={safeCurrentUser}
              />
            )}
          </div>
        )}

        {activeTab === 'collect' && (
          <div style={styles.section}>
            <CollectCash
              userInfo={safeCurrentUser}
              eventData={safeEventData}
              sellers={safeSellers}
            />
          </div>
        )}

        {/* 🆕 新增Tab内容 */}
        {activeTab === 'submit' && (
          <div style={styles.section}>
            <SubmitCash
              userInfo={safeCurrentUser}
              eventData={safeEventData}
            />
          </div>
        )}

        {activeTab === 'sellers' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>👥 Sellers ({safeSellers.length})</h2>
              <div style={styles.actionsBar}>
                <button style={styles.refreshButton}>
                  🔄 数据实时更新中
                </button>
                <div style={styles.allocationInfo}>
                  💡 每次最高分配: <strong>RM {maxPerAllocation}</strong>
                </div>
              </div>
            </div>

            {loadingSellers ? (
              <div style={styles.loadingCard}>
                <div style={styles.spinner}></div>
                <p>加载 Sellers...</p>
              </div>
            ) : (
              <SellerList
                sellers={safeSellers}
                selectedDepartment={null}
                onSelectSeller={handleAllocatePoints}
                eventId={eventId}
                orgId={safeCurrentUser.organizationId}
                currentUser={safeCurrentUser}
              />
            )}
          </div>
        )}
      </div>

      {/* Allocate Points Modal */}
      {showAllocatePoints && selectedSeller && (
        <AllocatePoints
          seller={selectedSeller}
          sellerManager={safeCurrentUser}
          organizationId={safeCurrentUser.organizationId}
          eventId={eventId}
          maxPerAllocation={maxPerAllocation}
          onClose={() => {
            setShowAllocatePoints(false);
            setSelectedSeller(null);
          }}
          onSuccess={() => {
            console.log('[SM Dashboard] 点数分配成功，数据将自动更新');
          }}
        />
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '1rem'
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
    borderTopColor: '#f59e0b',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
    background: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'flex-start'
  },
  title: {
    fontSize: '1.75rem',
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
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  userInfo: {
    padding: '0.5rem 1rem',
    background: '#fef3c7',
    borderRadius: '8px'
  },
  userName: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#92400e',
    marginBottom: '0.25rem'
  },
  allocationLimit: {
    fontSize: '0.75rem',
    fontWeight: '500',
    color: '#b45309'
  },
  logoutButton: {
    padding: '0.5rem 1rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  versionBadge: {
    padding: '0.5rem 0.75rem',
    background: '#e5e7eb',
    color: '#374151',
    borderRadius: '8px',
    fontSize: '0.625rem',
    fontWeight: '600',
    letterSpacing: '0.5px'
  },
  section: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    padding: '1.5rem',
    marginBottom: '1rem'
  },
  sectionHeader: {
    marginBottom: '1.5rem'
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 1rem 0'
  },
  actionsBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  refreshButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#6b7280',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  allocationInfo: {
    padding: '0.75rem 1.5rem',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  // Tab样式
  tabs: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
    background: 'white',
    padding: '1rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  tab: {
    padding: '0.75rem 1.5rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    transition: 'all 0.2s'
  },
  activeTab: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white'
  },
  content: {
    background: 'white',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    marginBottom: '1rem'
  },
  departmentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1.5rem'
  },
  departmentCard: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem'
  },
  deptCode: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#f59e0b',
    marginBottom: '0.5rem'
  },
  deptName: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '1rem'
  },
  deptStats: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    fontSize: '0.875rem',
    color: '#374151'
  },
  emptyState: {
    textAlign: 'center',
    padding: '2rem',
    color: '#6b7280'
  }
};

const styleSheet = document.styleSheets[0];
if (styleSheet) {
  try {
    styleSheet.insertRule(`@keyframes spin { to { transform: rotate(360deg); } }`, styleSheet.cssRules.length);
  } catch (e) { }
}

export default SellerManagerDashboard;
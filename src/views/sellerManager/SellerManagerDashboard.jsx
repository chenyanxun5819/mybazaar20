import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db, BUILD_TIMESTAMP } from '../../config/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import AllocatePoints from './components/AllocatePoints';
import SellerList from './components/SellerList';
import OverviewStats from './components/OverviewStats';
import SubmitCash from './components/SubmitCash';    // 新增

/**
 * Seller Manager Dashboard (简化版)
 * 移除部门过滤，直接显示所有 Sellers
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

  // 新增：标签页管理
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    initializeDashboard();
  }, []);

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

  const initializeDashboard = async () => {
    try {
      setLoading(true);

      const storedInfo = localStorage.getItem('sellerManagerInfo');
      if (!storedInfo) {
        console.warn('[SM Dashboard] 未找到登录信息');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      let userInfo;
      try {
        userInfo = JSON.parse(storedInfo);
      } catch (e) {
        console.error('[SM Dashboard] 解析用户信息失败:', e);
        navigate(`/login/${orgEventCode}`);
        return;
      }

      console.log('[SM Dashboard] 用户信息:', userInfo);

      // 验证
      if (!userInfo || typeof userInfo !== 'object') {
        console.error('[SM Dashboard] 用户信息格式错误');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      if (!Array.isArray(userInfo.roles) || !userInfo.roles.includes('sellerManager')) {
        alert('您没有 Seller Manager 权限');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      if (!Array.isArray(userInfo.managedDepartments) || userInfo.managedDepartments.length === 0) {
        alert('您还没有被分配管理任何部门');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      setCurrentUser(userInfo);
      setEventId(userInfo.eventId);

      // 加载活动信息
      const eventDoc = await getDoc(
        doc(db, 'organizations', userInfo.organizationId, 'events', userInfo.eventId)
      );

      if (eventDoc.exists()) {
        const data = eventDoc.data();
        setEventData(data || {});
        console.log('[SM Dashboard] 活动数据加载成功');

        // 显示点数分配规则
        if (data && data.pointAllocationRules && data.pointAllocationRules.sellerManager) {
          console.log('[SM Dashboard] 点数分配规则:', data.pointAllocationRules.sellerManager);
          console.log('[SM Dashboard] 每次最高分配:', data.pointAllocationRules.sellerManager.maxPerAllocation);
        } else {
          console.warn('[SM Dashboard] ⚠️ 未找到 pointAllocationRules');
        }
      } else {
        throw new Error('活动不存在');
      }

    } catch (error) {
      console.error('[SM Dashboard] 初始化失败:', error);
      alert(`加载失败: ${error.message}`);
      navigate(`/login/${orgEventCode}`);
    } finally {
      setLoading(false);
    }
  };


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
        // ❌ 移除这行：where('identityInfo.department', 'in', currentUser.managedDepartments.slice(0, 10))
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

          // ✅ 聚合数据（保持原有逻辑）
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

      // 保存 unsubscribe 以便清理
      return unsubscribe;

    } catch (error) {
      console.error('❌ 加载 Sellers 异常:', error);
      setSellers([]);
      setLoadingSellers(false);
    }
  };




  // Line 300 之后添加

  /**
   * 聚合被管理的 Sellers 的统计数据
   * @param {Array} sellersList - sellers 数组
   * @returns {Object} 聚合后的统计数据
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
      totalRevenue += totalSold;
      totalCollected += totalCashCollected;

      const pending = totalSold - totalCashCollected;
      pendingCollection += pending;

      // 检查收款警示
      if (sellerData.collectionAlert) {
        usersWithWarnings++;

        const pendingRatio = totalSold > 0 ? pending / totalSold : 0;
        if (pendingRatio >= 0.5) {
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
   * 按部门聚合 Sellers 的统计数据
   * @param {Array} sellersList - sellers 数组
   * @returns {Array} 各部门的聚合数据
   */
  const aggregateDepartmentStats = (sellersList) => {
    if (!Array.isArray(sellersList) || sellersList.length === 0) {
      return [];
    }

    const deptMap = {};

    sellersList.forEach(seller => {
      const dept = seller.identityInfo?.department || 'unknown';
      const sellerData = seller.seller || {};

      if (!deptMap[dept]) {
        deptMap[dept] = {
          id: dept,
          departmentCode: dept,
          departmentName: dept,  // 可以从 eventData.departments 获取完整名称
          membersStats: {
            totalCount: 0,
            activeCount: 0
          },
          pointsStats: {
            currentBalance: 0,
            totalRevenue: 0,
            totalCollected: 0,
            pendingCollection: 0,
            collectionRate: 0
          },
          collectionAlerts: {
            usersWithWarnings: 0,
            highRiskUsers: []
          },
          allocationStats: {
            totalAllocations: 0,
            byEventManager: { count: 0, totalPoints: 0 },
            bySellerManager: { count: 0, totalPoints: 0 }
          }
        };
      }

      const deptStats = deptMap[dept];
      deptStats.membersStats.totalCount++;

      const availablePoints = sellerData.availablePoints || 0;
      const totalSold = sellerData.totalPointsSold || 0;
      const totalCollected = sellerData.totalCashCollected || 0;
      const pending = totalSold - totalCollected;

      if (totalSold > 0) {
        deptStats.membersStats.activeCount++;
      }

      deptStats.pointsStats.currentBalance += availablePoints;
      deptStats.pointsStats.totalRevenue += totalSold;
      deptStats.pointsStats.totalCollected += totalCollected;
      deptStats.pointsStats.pendingCollection += pending;

      // 检查警示
      if (sellerData.collectionAlert) {
        deptStats.collectionAlerts.usersWithWarnings++;

        const pendingRatio = totalSold > 0 ? pending / totalSold : 0;
        if (pendingRatio >= 0.5) {
          deptStats.collectionAlerts.highRiskUsers.push(seller.userId);
        }
      }
    });

    // 计算各部门的收款率
    Object.values(deptMap).forEach(dept => {
      const { totalRevenue, totalCollected } = dept.pointsStats;
      dept.pointsStats.collectionRate = totalRevenue > 0 ? totalCollected / totalRevenue : 0;
    });

    return Object.values(deptMap);
  };

  const handleAllocatePoints = (seller) => {
    if (!seller || typeof seller !== 'object') {
      console.error('[SM Dashboard] 无效的 seller 对象');
      return;
    }

    console.log('[SM Dashboard] 准备为 Seller 分配点数:', seller.userId);
    setSelectedSeller(seller);
    setShowAllocatePoints(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('sellerManagerInfo');
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('[SM Dashboard] 退出登录失败:', error);
      alert('退出登录失败');
    }
  };

  const safeCurrentUser = currentUser || {};
  const safeEventData = eventData || {};
  const safeSellers = Array.isArray(sellers) ? sellers : [];
  const safeDepartmentStats = Array.isArray(departmentStats) ? departmentStats : [];

  const maxPerAllocation = resolveMaxPerAllocation(eventData);
  const warningThreshold = resolveWarningThreshold(eventData);

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

  // 默认统计数据
  const getDefaultStats = () => ({
    managedUsersStats: {
      totalUsers: 0,
      activeUsers: 0,
      currentBalance: 0,
      totalRevenue: 0,
      totalCollected: 0,
      pendingCollection: 0,
      collectionRate: 0,
      usersWithWarnings: 0,
      highRiskUsers: 0
    },
    allocationStats: {
      totalAllocations: 0,
      totalPointsAllocated: 0,
      averagePerAllocation: 0
    },
    collectionManagement: {
      usersWithWarnings: 0,
      highRiskUsers: 0
    }
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div>
            <h1 style={styles.title}>Seller Manager 仪表板</h1>
            <p style={styles.subtitle}>
              欢迎, {safeCurrentUser.displayName || safeCurrentUser.phoneNumber || '未知用户'}
            </p>
            <p style={styles.roleLabel}>
              管理部门: {Array.isArray(safeCurrentUser.managedDepartments) ? safeCurrentUser.managedDepartments.join(', ') : '无'}
            </p>
          </div>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.userInfo}>
            <div style={styles.userName}>
              {getLocalizedText(safeEventData.eventName) || '义卖活动'}
            </div>
            <div style={styles.allocationLimit}>
              每次最高分配: RM {maxPerAllocation}
            </div>
          </div>
          <div style={styles.versionBadge} title="目前載入的前端版本戳記">
            Build: {BUILD_TIMESTAMP}
          </div>
          <button style={styles.logoutButton} onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </div>

      {/* 标签页导航 */}
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            ...styles.tab,
            ...(activeTab === 'overview' ? styles.activeTab : {})
          }}
        >
          📊 概览
        </button>
        <button
          onClick={() => setActiveTab('departments')}
          style={{
            ...styles.tab,
            ...(activeTab === 'departments' ? styles.activeTab : {})
          }}
        >
          🏫 部门管理
        </button>
        <button
          onClick={() => setActiveTab('sellers')}
          style={{
            ...styles.tab,
            ...(activeTab === 'sellers' ? styles.activeTab : {})
          }}
        >
          👥 Sellers 管理
        </button>
        <button
          onClick={() => setActiveTab('allocate')}
          style={{
            ...styles.tab,
            ...(activeTab === 'allocate' ? styles.activeTab : {})
          }}
        >
          📦 分配点数
        </button>

        <button
          onClick={() => setActiveTab('submit')}
          style={{
            ...styles.tab,
            ...(activeTab === 'submit' ? styles.activeTab : {})
          }}
        >
          📤 上交现金
        </button>
      </div>

      {/* 内容区域 */}
      <div style={styles.content}>
        {activeTab === 'overview' && (
          <div style={styles.section}>
            <OverviewStats
              smStats={smStats || getDefaultStats()}
              departmentStats={safeDepartmentStats}
              eventData={safeEventData}
            />
          </div>
        )}

        {activeTab === 'departments' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>🏫 部门管理</h2>
            </div>
            {safeDepartmentStats.length === 0 ? (
              <div style={styles.emptyState}>
                <p>暂无部门数据</p>
              </div>
            ) : (
              <div style={styles.departmentGrid}>
                {safeDepartmentStats.map(dept => (
                  <div key={dept.id} style={styles.departmentCard}>
                    <div style={styles.deptCode}>{dept.departmentCode}</div>
                    <div style={styles.deptName}>{dept.departmentName}</div>
                    <div style={styles.deptStats}>
                      <div>成员: {dept.membersStats?.totalCount || 0}</div>
                      <div>销售额: RM {(dept.pointsStats?.totalRevenue || 0).toLocaleString()}</div>
                      <div>已收款: RM {(dept.pointsStats?.totalCollected || 0).toLocaleString()}</div>
                      <div style={{
                        color: (dept.pointsStats?.collectionRate || 0) >= 0.8 ? '#10b981' : '#f59e0b'
                      }}>
                        收款率: {Math.round((dept.pointsStats?.collectionRate || 0) * 100)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'sellers' && (
          <div style={styles.section}>
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

        {activeTab === 'allocate' && (
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>📦 分配点数</h2>
              <div style={styles.allocationInfo}>
                💡 每次最高分配: <strong>RM {maxPerAllocation}</strong>
              </div>
            </div>
            <AllocatePoints
              sellers={safeSellers}
              sellerManager={safeCurrentUser}
              organizationId={safeCurrentUser.organizationId}
              eventId={eventId}
              maxPerAllocation={maxPerAllocation}
            />
          </div>
        )}



        {activeTab === 'submit' && (
          <SubmitCash
            userInfo={safeCurrentUser}
            eventData={safeEventData}
          />
        )}
      </div>

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
  // 新增：标签页样式
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
  // 新增：部门管理样式
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
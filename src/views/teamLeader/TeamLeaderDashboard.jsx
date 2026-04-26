import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db, BUILD_TIMESTAMP } from '../../config/firebase';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext'; // 🆕 Use AuthContext
import { useEvent } from '../../contexts/EventContext'; // 🆕 导入 EventContext
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import AllocatePoints from './components/AllocatePoints';
import CustomerList from './components/CustomerList'; // ✅ 改为 CustomerList
import OverviewStats from './components/OverviewStats';
import CollectCash from './components/CollectCash';
import SubmitCash from './components/SubmitCash';
import TeamLeaderTransactions from './components/TeamLeaderTransactions';

/**
 * Team Leader Dashboard (修复版 v2.1)
 * 
 * 🔧 关键修复：
 * 1. SellerList 的 prop 名称从 currentUser 改为 userInfo（第632行）
 * 2. 增强 console.log 输出，便于诊断 sellers 为空的问题
 * 3. 添加详细的调试信息
 * 
 * @version 2.1
 * @date 2025-02-15
 */

// 全域輔助：根據活動資料取得每次最高可分配點數（提供穩定 fallback）
const resolveMaxPerAllocation = (eventData) => {
  if (!eventData || typeof eventData !== 'object') return 100;
  try {
    const rule = eventData.pointAllocationRules?.teamLeader;
    if (rule && typeof rule.maxPerAllocation === 'number') return rule.maxPerAllocation;
    return 100;
  } catch { return 100; }
};

// 全域輔助：警示門檻
const resolveWarningThreshold = (eventData) => {
  if (!eventData || typeof eventData !== 'object') return 0.3;
  try {
    const rule = eventData.pointAllocationRules?.teamLeader;
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

const TeamLeaderDashboard = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  const { eventCode: contextEventCode } = useEvent();
  const { userProfile, loading: authLoading } = useAuth();

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
          navigate(`/login/${orgEventCode}`);
          return;
        }

        console.log('[SM Dashboard] 用户信息 (AuthContext):', userProfile);

        if (!userProfile.roles || !userProfile.roles.includes('teamLeader')) {
          window.mybazaarShowToast('您没有 Team Leader 权限');
          navigate(`/login/${orgEventCode}`);
          return;
        }

        // 🔧 修复：健壮的部门检查逻辑
        const managedDepts = userProfile.teamLeader?.managedDepartments || userProfile.managedDepartments || [];

        // 🔧 添加详细的调试输出
        console.log('[SM Dashboard] 🔍 managedDepartments 检查:');
        console.log('  - teamLeader.managedDepartments:', userProfile.teamLeader?.managedDepartments);
        console.log('  - 根目录 managedDepartments:', userProfile.managedDepartments);
        console.log('  - 最终使用:', managedDepts);
        console.log('  - 是否为数组:', Array.isArray(managedDepts));
        console.log('  - 数组长度:', managedDepts.length);

        if (!Array.isArray(managedDepts) || managedDepts.length === 0) {
          console.warn('[SM Dashboard] ⚠️ 注意：您还没有被分配管理任何部门');
          console.warn('[SM Dashboard] 💡 请联系 Event Manager 为您分配部门');
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
          console.log('[SM Dashboard] ✅ 活动数据加载成功');
        }
      } catch (error) {
        console.error('[SM Dashboard] ❌ 初始化失败:', error);
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

  const loadSellers = () => {
    if (!currentUser || !eventId) {
      console.warn('[loadSellers] ⚠️ 缺少必要参数:', { currentUser: !!currentUser, eventId });
      return;
    }

    try {
      setLoadingSellers(true);

      // 🔧 修复：更详细的调试输出
      console.log('[loadSellers] 🔍 开始查询 Sellers');
      console.log('[loadSellers] organizationId:', currentUser.organizationId);
      console.log('[loadSellers] eventId:', eventId);
      console.log('[loadSellers] managedDepartments:', currentUser.managedDepartments);

      if (!Array.isArray(currentUser.managedDepartments) || currentUser.managedDepartments.length === 0) {
        console.warn('[loadSellers] ⚠️ 没有管理的部门，将返回空列表');
        console.warn('[loadSellers] 💡 这是正常的，如果您刚被创建为 Team Leader 但还未分配部门');
        setSellers([]);
        setLoadingSellers(false);
        return;
      }

      console.log(`[loadSellers] 📊 管理 ${currentUser.managedDepartments.length} 个部门:`, currentUser.managedDepartments);

      // Firestore 查询路径
      const collectionPath = `organizations/${currentUser.organizationId}/events/${eventId}/users`;
      console.log('[loadSellers] 📂 查询路径:', collectionPath);

      // ✅ 只使用 array-contains 查询
      const q = query(
        collection(db, collectionPath),
        where('roles', 'array-contains', 'pointSeller')
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          console.log(`[loadSellers] 📥 收到快照更新，共 ${snapshot.size} 条记录`);

          const list = [];
          let totalCount = 0;
          let filteredOutCount = 0;

          snapshot.forEach(doc => {
            totalCount++;
            const data = doc.data() || {};

            // 🔧 添加详细的调试信息
            if (totalCount === 1) {
              console.log('[loadSellers] 📋 第一条记录样本:');
              console.log('  - userId:', doc.id);
              console.log('  - roles:', data.roles);
              console.log('  - identityInfo.department:', data.identityInfo?.department);
              console.log('  - basicInfo.chineseName:', data.basicInfo?.chineseName);
            }

            // ✅ 客户端过滤：只保留管理范围内的 sellers
            if (currentUser.managedDepartments &&
              data.identityInfo?.department &&
              currentUser.managedDepartments.includes(data.identityInfo.department)) {

              list.push({
                id: doc.id,
                userId: doc.id,
                ...data
              });
            } else {
              filteredOutCount++;
              
              // 🔧 记录为什么被过滤
              if (totalCount <= 3) { // 只记录前3条，避免日志太多
                console.log(`[loadSellers] ⚠️ 记录 ${doc.id} 被过滤:`);
                console.log('  - 原因: department 不在 managedDepartments 中');
                console.log('  - seller department:', data.identityInfo?.department);
                console.log('  - managed departments:', currentUser.managedDepartments);
              }
            }
          });

          // 排序：最新创建的在前
          list.sort((a, b) => {
            const timeA = (a.accountStatus?.createdAt?.toMillis) ? a.accountStatus.createdAt.toMillis() : 0;
            const timeB = (b.accountStatus?.createdAt?.toMillis) ? b.accountStatus.createdAt.toMillis() : 0;
            return timeB - timeA;
          });

          console.log(`[loadSellers] ✅ 查询完成:`);
          console.log(`  - 数据库总记录: ${totalCount}`);
          console.log(`  - 符合条件: ${list.length}`);
          console.log(`  - 被过滤: ${filteredOutCount}`);

          if (list.length === 0 && totalCount > 0 && import.meta.env.DEV) {
            console.info('[loadSellers] 调试信息: 数据库有 seller，但没有一个在您管理的部门中');
            console.info('[loadSellers] 可能原因:');
            console.info('  1. sellers 的 department 字段与 managedDepartments 不匹配');
            console.info('  2. Event Manager 还未将 sellers 分配到您管理的部门');
            console.info('  3. department 字段路径不正确（应该是 identityInfo.department）');
          }

          if (list.length > 0) {
            console.log('[loadSellers] 📊 前3条记录预览:');
            list.slice(0, 3).forEach((seller, idx) => {
              console.log(`  ${idx + 1}. ${seller.basicInfo?.chineseName} (${seller.identityInfo?.department})`);
            });
          }

          setSellers(list);
          setLoadingSellers(false);

          // ✅ 聚合数据
          const aggregatedStats = aggregateManagedUsersStats(list);
          const aggregatedDepts = aggregateDepartmentStats(list);

          setManagedUsersStats(aggregatedStats);
          setDepartmentStats(aggregatedDepts);
        },
        (error) => {
          console.error('[loadSellers] ❌ 监听失败:', error);
          console.error('[loadSellers] 错误详情:', error.code, error.message);
          
          if (error.code === 'permission-denied') {
            console.error('[loadSellers] 🔒 权限被拒绝，请检查 Firestore Security Rules');
          }
          
          setSellers([]);
          setLoadingSellers(false);
        }
      );

      return unsubscribe;

    } catch (error) {
      console.error('[loadSellers] ❌ 设置查询异常:', error);
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
      totalUsers++;

      const sellerPoints = seller.pointSeller || {};
      const balance = sellerPoints.availablePoints || 0;
      const revenue = sellerPoints.totalRevenue || 0;
      const collected = sellerPoints.totalCashCollected || 0;
      const pending = sellerPoints.pendingCollection || 0;

      if (revenue > 0 || balance > 0) {
        activeUsers++;
      }

      currentBalance += balance;
      totalRevenue += revenue;
      totalCollected += collected;
      pendingCollection += pending;

      const collectionAlert = seller.collectionAlert || {};
      if (collectionAlert.hasWarning) {
        usersWithWarnings++;
      }
      if (collectionAlert.riskLevel === 'high') {
        highRiskUsers++;
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
   * 按部门聚合统计数据
   */
  const aggregateDepartmentStats = (sellersList) => {
    if (!Array.isArray(sellersList) || sellersList.length === 0) {
      return [];
    }

    const deptMap = {};

    sellersList.forEach(seller => {
      const dept = seller.identityInfo?.department || '未分配';

      if (!deptMap[dept]) {
        deptMap[dept] = {
          departmentCode: dept,
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

      const d = deptMap[dept];
      d.totalCount++;

      const sellerPoints = seller.pointSeller || {};
      const balance = sellerPoints.availablePoints || 0;
      const revenue = sellerPoints.totalRevenue || 0;
      const collected = sellerPoints.totalCashCollected || 0;
      const pending = sellerPoints.pendingCollection || 0;

      if (revenue > 0 || balance > 0) {
        d.activeCount++;
      }

      d.currentBalance += balance;
      d.totalRevenue += revenue;
      d.totalCollected += collected;
      d.pendingCollection += pending;

      const collectionAlert = seller.collectionAlert || {};
      if (collectionAlert.hasWarning) {
        d.usersWithWarnings++;
      }
      if (collectionAlert.riskLevel === 'high') {
        d.highRiskUsers++;
      }
    });

    const deptArray = Object.values(deptMap).map(dept => ({
      departmentCode: dept.departmentCode,
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
        highRiskUsers: dept.highRiskUsers > 0 ? [] : []
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
      localStorage.removeItem('teamLeaderInfo');
      localStorage.removeItem('currentUser');
      console.log('[SM Dashboard] 用户已登出');
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('[SM Dashboard] 登出失败:', error);
      window.mybazaarShowToast('登出失败，请重试');
    }
  };

  const handleRefresh = () => {
    window.location.reload();
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
  const eventCodeForFooter = contextEventCode || safeEventData?.eventCode || userProfile?.eventCode || orgEventCode?.split('-')?.[1] || '';

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
      {/* 🆕 共用 Header 组件 */}
      <DashboardHeader
        title="班导师管理"
        subtitle="Team Leader Dashboard"
        logoUrl={eventData?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName}
        userPhone={userProfile?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.includes('teamLeader') ? 'teamLeader' : userProfile?.roles?.[0]}
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

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
            ...(activeTab === 'collect' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('collect')}
        >
          💵 收取现金
        </button>
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
          👥 学生清单
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'history' ? styles.activeTab : {})
          }}
          onClick={() => setActiveTab('history')}
        >
          📜 分配历史
        </button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'overview' && (
          <div style={styles.section}>
            <OverviewStats
              organizationId={safeCurrentUser.organizationId}
              eventId={eventId}
              teamLeaderId={safeCurrentUser.userId}
              managedDepartments={safeCurrentUser.managedDepartments || []}
              eventData={safeEventData}
            />
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

        {activeTab === 'submit' && (
          <SubmitCash userInfo={safeCurrentUser} eventData={safeEventData} />
        )}

        {activeTab === 'sellers' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>👥 学生列表 ({safeSellers.length})</h2>
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
                <p>加载学生列表...</p>
              </div>
            ) : (
              <CustomerList
                customers={safeSellers}
                selectedDepartment={null}
                onSelectCustomer={handleAllocatePoints}
                onConfirmPayment={null}
                userInfo={safeCurrentUser}
              />
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div style={styles.section}>
            <TeamLeaderTransactions
              organizationId={safeCurrentUser.organizationId}
              eventId={eventId}
              teamLeaderId={safeCurrentUser.userId}
              managedDepartments={safeCurrentUser.managedDepartments || []}
            />
          </div>
        )}
      </div>

      {/* Allocate Points Modal */}
      {showAllocatePoints && selectedSeller && (
        <AllocatePoints
          seller={selectedSeller}
          teamLeader={safeCurrentUser}
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

      {/* 🆕 共用 Footer 组件 */}
      <DashboardFooter 
        event={eventData}
        eventCode={eventCodeForFooter}
        showEventInfo={true}
      />
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

export default TeamLeaderDashboard;
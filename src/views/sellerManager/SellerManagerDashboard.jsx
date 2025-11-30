import { useState, useEffect } from 'react';
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
  
  const [sellers, setSellers] = useState([]);
  const [loadingSellers, setLoadingSellers] = useState(false);
  
  const [showAllocatePoints, setShowAllocatePoints] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState(null);

  useEffect(() => {
    initializeDashboard();
  }, []);

  useEffect(() => {
    let unsubscribeStats = null;
    let unsubscribeSellers = null;

    if (currentUser && eventId) {
      unsubscribeStats = subscribeToStats();
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

  const subscribeToStats = () => {
    if (!currentUser || !eventId) return;

    const unsubscribers = [];

    try {
      // 监听 Seller Manager 统计
      const smStatsRef = doc(
        db,
        'organizations', currentUser.organizationId,
        'events', eventId,
        'sellerManagerStats', currentUser.userId
      );
      
      const unsubSM = onSnapshot(
        smStatsRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            setSmStats(data || getDefaultStats());
            console.log('[SM Dashboard] SM 统计更新');
          } else {
            console.warn('[SM Dashboard] SM 统计不存在');
            setSmStats(getDefaultStats());
          }
        },
        (error) => {
          console.error('[SM Dashboard] SM 统计监听错误:', error);
          setSmStats(getDefaultStats());
        }
      );
      unsubscribers.push(unsubSM);

      // 监听部门统计
      if (Array.isArray(currentUser.managedDepartments) && currentUser.managedDepartments.length > 0) {
        const deptQuery = query(
          collection(db, 'organizations', currentUser.organizationId, 'events', eventId, 'departmentStats'),
          where('__name__', 'in', currentUser.managedDepartments.slice(0, 10))
        );
        
        const unsubDept = onSnapshot(
          deptQuery,
          (snapshot) => {
            const depts = [];
            snapshot.forEach(doc => {
              depts.push({
                id: doc.id,
                departmentCode: doc.id,
                ...(doc.data() || {})
              });
            });
            setDepartmentStats(depts);
            console.log('[SM Dashboard] 部门统计更新:', depts.length);
          },
          (error) => {
            console.error('[SM Dashboard] 部门统计错误:', error);
            setDepartmentStats([]);
          }
        );
        unsubscribers.push(unsubDept);
      }

    } catch (error) {
      console.error('[SM Dashboard] 订阅失败:', error);
    }

    return () => {
      unsubscribers.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
    };
  };

  const loadSellers = () => {
    if (!currentUser || !eventId) return;

    try {
      setLoadingSellers(true);

      if (!Array.isArray(currentUser.managedDepartments) || currentUser.managedDepartments.length === 0) {
        setSellers([]);
        setLoadingSellers(false);
        return;
      }

      const q = query(
        collection(db, 'organizations', currentUser.organizationId, 'events', eventId, 'users'),
        where('roles', 'array-contains', 'seller'),
        where('identityInfo.department', 'in', currentUser.managedDepartments.slice(0, 10))
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list = [];
          snapshot.forEach(doc => {
            list.push({
              id: doc.id,
              userId: doc.id,
              ...(doc.data() || {})
            });
          });
          
          list.sort((a, b) => {
            const timeA = (a.accountStatus && a.accountStatus.createdAt && a.accountStatus.createdAt.toMillis) ? a.accountStatus.createdAt.toMillis() : 0;
            const timeB = (b.accountStatus && b.accountStatus.createdAt && b.accountStatus.createdAt.toMillis) ? b.accountStatus.createdAt.toMillis() : 0;
            return timeB - timeA;
          });
          
          setSellers(list);
          setLoadingSellers(false);
          console.log('[SM Dashboard] Sellers 列表更新:', list.length);
        },
        (error) => {
          console.error('[SM Dashboard] Sellers 查询错误:', error);
          setSellers([]);
          setLoadingSellers(false);
        }
      );

      return unsubscribe;

    } catch (error) {
      console.error('[SM Dashboard] 加载 Sellers 失败:', error);
      setSellers([]);
      setLoadingSellers(false);
    }
  };

  const getDefaultStats = () => ({
    totalSellers: 0,
    activeSellers: 0,
    totalPointsAllocated: 0,
    totalPointsSold: 0,
    totalCashCollected: 0,
    pendingReconciliation: 0
  });

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

      {/* 概览统计 */}
      <div style={styles.section}>
        <OverviewStats
          smStats={smStats || getDefaultStats()}
          departmentStats={safeDepartmentStats}
          eventData={safeEventData}
        />
      </div>

      {/* Sellers 列表 */}
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
            onAllocatePoints={handleAllocatePoints}
            maxPerAllocation={maxPerAllocation}
          />
        )}
      </div>

      {showAllocatePoints && selectedSeller && (
        <AllocatePoints
          seller={selectedSeller}
          sellerManagerId={safeCurrentUser.userId}
          eventId={eventId}
          maxPerAllocation={maxPerAllocation}
          warningThreshold={warningThreshold}
          onClose={() => {
            setShowAllocatePoints(false);
            setSelectedSeller(null);
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
  }
};

const styleSheet = document.styleSheets[0];
if (styleSheet) {
  try {
    styleSheet.insertRule(`@keyframes spin { to { transform: rotate(360deg); } }`, styleSheet.cssRules.length);
  } catch (e) {}
}

export default SellerManagerDashboard;
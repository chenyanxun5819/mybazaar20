import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { 
  doc, 
  getDoc, 
  collection, 
  query,
  where,
  onSnapshot,
  orderBy,
  limit
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import AllocatePoints from './components/AllocatePoints';
import SellerList from './components/SellerList';
import OverviewStats from './components/OverviewStats';
import DepartmentList from './components/DepartmentList';

/**
 * Seller Manager Dashboard (重构版)
 * 
 * @description
 * Seller Manager 的主控制台
 * 
 * 功能：
 * 1. 查看个人统计（从 sellerManagerStats 读取）
 * 2. 查看管理的部门统计（从 departmentStats 读取）
 * 3. 管理所有 managedDepartments 内的 Seller（不限 identityTag）
 * 4. 分配点数给 Seller（受 maxPerAllocation 限制）
 * 5. 监控收款警示
 * 
 * 新架构路径：
 * - Event/{eventId}
 * - Event/{eventId}/users/{userId}
 * - Event/{eventId}/sellerManagerStats/{sellerManagerId}
 * - Event/{eventId}/departmentStats/{departmentCode}
 * 
 * @route /:orgCode-:eventCode/phone/seller-manager-dashboard
 */
const SellerManagerDashboard = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  
  // === 基础数据状态 ===
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null); // Seller Manager 用户信息
  const [eventData, setEventData] = useState(null);
  const [eventId, setEventId] = useState(null);
  
  // === 统计数据 ===
  const [smStats, setSmStats] = useState(null); // Seller Manager 统计
  const [departmentStats, setDepartmentStats] = useState([]); // 管理的部门统计
  
  // === Sellers 数据 ===
  const [sellers, setSellers] = useState([]);
  const [loadingSellers, setLoadingSellers] = useState(false);
  
  // === UI 状态 ===
  const [activeTab, setActiveTab] = useState('overview'); // overview | departments | sellers | allocate
  const [showAllocatePoints, setShowAllocatePoints] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState(null);

  // === 初始化：加载用户和活动数据 ===
  useEffect(() => {
    initializeDashboard();
  }, []);

  // === 监听统计数据 ===
  useEffect(() => {
    if (currentUser && eventId) {
      subscribeToStats();
      loadSellers();
    }
  }, [currentUser, eventId]);

  /**
   * 初始化 Dashboard
   */
  const initializeDashboard = async () => {
    try {
      setLoading(true);

      console.log('[SM Dashboard] 初始化开始');
      console.log('[SM Dashboard] orgEventCode:', orgEventCode);

      // 🔐 从 localStorage 获取登录信息
      const storedInfo = localStorage.getItem('sellerManagerInfo'); // ✅ 修复：使用正确的 key
      console.log('[SM Dashboard] localStorage key: sellerManagerInfo');
      console.log('[SM Dashboard] localStorage 数据:', storedInfo ? '存在' : '不存在');
      
      if (!storedInfo) {
        console.warn('[SM Dashboard] 未找到登录信息');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      const userInfo = JSON.parse(storedInfo);
      console.log('[SM Dashboard] 用户信息:', userInfo);

      // 🎯 验证是否有 sellerManager 角色
      if (!userInfo.roles?.includes('sellerManager')) {
        console.error('[SM Dashboard] 用户没有 sellerManager 角色');
        alert('您没有 Seller Manager 权限');
        navigate(`/login/${orgEventCode}`);
        return;
      }

      // 🎯 验证是否有 managedDepartments（可选检查，如果没有则警告但继续）
      if (!userInfo.managedDepartments || userInfo.managedDepartments.length === 0) {
        console.warn('[SM Dashboard] 用户没有 managedDepartments');
        // 不阻止登录，因为可能还没有分配部门
        // alert('您还没有被分配管理任何部门');
        // navigate(`/login/${orgEventCode}`);
        // return;
      }

      setCurrentUser(userInfo);
      setEventId(userInfo.eventId);

      console.log('[SM Dashboard] 用户状态设置完成');
      console.log('[SM Dashboard] eventId:', userInfo.eventId);

      // 📋 加载活动信息
      const eventDoc = await getDoc(doc(db, 'Event', userInfo.eventId));
      if (eventDoc.exists()) {
        setEventData(eventDoc.data());
        console.log('[SM Dashboard] 活动数据加载成功');
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

  /**
   * 订阅统计数据（实时监听）
   */
  const subscribeToStats = () => {
    // 🔔 监听 Seller Manager 统计
    const smStatsRef = doc(db, 'Event', eventId, 'sellerManagerStats', currentUser.userId);
    const unsubscribeSM = onSnapshot(
      smStatsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setSmStats(snapshot.data());
          console.log('[SM Dashboard] SM 统计更新:', snapshot.data());
        } else {
          console.warn('[SM Dashboard] SM 统计文档不存在，可能尚未创建');
          // 设置默认值
          setSmStats({
            managedUsersStats: {
              totalUsers: 0,
              activeUsers: 0,
              totalPointsReceived: 0,
              currentBalance: 0,
              totalSold: 0,
              totalRevenue: 0,
              totalCollected: 0,
              pendingCollection: 0,
              collectionRate: 0
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
        }
      },
      (error) => {
        console.error('[SM Dashboard] SM 统计监听错误:', error);
      }
    );

    // 🔔 监听部门统计
    const deptStatsQuery = query(
      collection(db, 'Event', eventId, 'departmentStats'),
      where('managedBy', 'array-contains', currentUser.userId)
    );
    
    const unsubscribeDept = onSnapshot(
      deptStatsQuery,
      (snapshot) => {
        const depts = [];
        snapshot.forEach(doc => {
          depts.push({
            id: doc.id,
            departmentCode: doc.id,
            ...doc.data()
          });
        });
        setDepartmentStats(depts);
        console.log('[SM Dashboard] 部门统计更新:', depts.length);
      },
      (error) => {
        console.error('[SM Dashboard] 部门统计监听错误:', error);
      }
    );

    // 返回清理函数
    return () => {
      unsubscribeSM();
      unsubscribeDept();
    };
  };

  /**
   * 加载管理的 Sellers
   * 
   * 查询逻辑：
   * 1. 查询 roles 包含 'seller'
   * 2. department 在 managedDepartments 数组中
   * 3. 不限制 identityTag（可以是 student, teacher, staff 等）
   */
  const loadSellers = async () => {
    try {
      setLoadingSellers(true);
      console.log('[SM Dashboard] 开始加载 Sellers...');
      console.log('[SM Dashboard] 管理的部门:', currentUser.managedDepartments);

      // ✅ 检查 managedDepartments 是否存在
      if (!currentUser.managedDepartments || currentUser.managedDepartments.length === 0) {
        console.warn('[SM Dashboard] 用户没有 managedDepartments，无法加载 Sellers');
        setSellers([]);
        setLoadingSellers(false);
        return;
      }

      const usersRef = collection(db, 'Event', eventId, 'users');
      
      // 🔍 策略：使用 where-in 查询（限制最多10个部门）
      if (currentUser.managedDepartments.length > 10) {
        console.warn('[SM Dashboard] 管理的部门超过10个，使用备选查询方案');
        // 备选方案：分批查询或使用其他策略
        // 这里简化处理，只查前10个
        alert('您管理的部门超过10个，系统只会显示前10个部门的数据');
      }

      const deptToQuery = currentUser.managedDepartments.slice(0, 10);

      const q = query(
        usersRef,
        where('roles', 'array-contains', 'seller'),
        where('department', 'in', deptToQuery),
        orderBy('createdAt', 'desc')
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const sellersList = [];
          snapshot.forEach(doc => {
            sellersList.push({
              id: doc.id,
              userId: doc.id,
              ...doc.data()
            });
          });
          
          setSellers(sellersList);
          console.log('[SM Dashboard] Sellers 更新:', sellersList.length);
        },
        (error) => {
          console.error('[SM Dashboard] Sellers 监听错误:', error);
          
          // 如果索引不存在，尝试简化查询
          if (error.code === 'failed-precondition') {
            console.warn('[SM Dashboard] 复合索引不存在，尝试简化查询');
            loadSellersFallback();
          }
        }
      );

      return unsubscribe;

    } catch (error) {
      console.error('[SM Dashboard] 加载 Sellers 失败:', error);
      setSellers([]);
    } finally {
      setLoadingSellers(false);
    }
  };

  /**
   * 备选方案：内存过滤
   */
  const loadSellersFallback = async () => {
    try {
      console.log('[SM Dashboard] 使用备选方案：内存过滤');
      
      const usersRef = collection(db, 'Event', eventId, 'users');
      const q = query(
        usersRef,
        where('roles', 'array-contains', 'seller'),
        orderBy('createdAt', 'desc'),
        limit(500) // 限制数量防止过载
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const allSellers = [];
        snapshot.forEach(doc => {
          allSellers.push({
            id: doc.id,
            userId: doc.id,
            ...doc.data()
          });
        });

        // 在内存中过滤出管理范围内的 Sellers
        const filteredSellers = allSellers.filter(seller =>
          currentUser.managedDepartments.includes(seller.department)
        );

        setSellers(filteredSellers);
        console.log('[SM Dashboard] 备选方案 Sellers 更新:', filteredSellers.length);
      });

      return unsubscribe;

    } catch (error) {
      console.error('[SM Dashboard] 备选方案也失败:', error);
      setSellers([]);
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
        console.error('[SM Dashboard] 登出失败:', error);
        alert('退出登录失败');
      }
    }
  };

  /**
   * 打开分配点数弹窗
   */
  const handleAllocatePoints = (seller) => {
    setSelectedSeller(seller);
    setShowAllocatePoints(true);
  };

  /**
   * 刷新数据
   */
  const handleRefresh = () => {
    // 实时监听会自动刷新，这里可以显示提示
    console.log('[SM Dashboard] 数据通过实时监听自动更新');
  };

  // === 渲染：加载中 ===
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

  // === 渲染：主界面 ===
  return (
    <div style={styles.container}>
      {/* 🎯 顶部导航栏 */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div>
            <h1 style={styles.title}>Seller Manager</h1>
            <p style={styles.subtitle}>
              {currentUser.displayName || '管理员'}
            </p>
            <p style={styles.roleLabel}>
              管理部门: {currentUser.managedDepartments?.join(', ') || '无'}
            </p>
          </div>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.userInfo}>
            <div style={styles.userName}>
              {eventData?.eventName || '义卖活动'}
            </div>
          </div>
          <button 
            style={styles.logoutButton}
            onClick={handleLogout}
          >
            退出登录
          </button>
        </div>
      </div>

      {/* 📊 Tab 导航 */}
      <div style={styles.tabBar}>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'overview' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('overview')}
        >
          📊 概览
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'departments' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('departments')}
        >
          🏫 部门
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'sellers' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('sellers')}
        >
          👥 Sellers ({sellers.length})
        </button>
      </div>

      {/* 📄 Tab 内容 */}
      <div style={styles.tabContent}>
        {activeTab === 'overview' && (
          <OverviewStats
            smStats={smStats}
            departmentStats={departmentStats}
            eventData={eventData}
          />
        )}

        {activeTab === 'departments' && (
          <DepartmentList
            departmentStats={departmentStats}
            onSelectDepartment={(dept) => {
              console.log('[SM Dashboard] 选中部门:', dept);
              setActiveTab('sellers');
            }}
          />
        )}

        {activeTab === 'sellers' && (
          <>
            <div style={styles.actionsBar}>
              <button
                style={styles.refreshButton}
                onClick={handleRefresh}
              >
                🔄 数据实时更新中
              </button>
            </div>
            {loadingSellers ? (
              <div style={styles.loadingCard}>
                <div style={styles.spinner}></div>
                <p>加载 Sellers...</p>
              </div>
            ) : (
              <SellerList
                sellers={sellers}
                onAllocatePoints={handleAllocatePoints}
                maxPerAllocation={eventData?.pointAllocationRules?.sellerManager?.maxPerAllocation || 100}
              />
            )}
          </>
        )}
      </div>

      {/* 🎭 分配点数弹窗 */}
      {showAllocatePoints && selectedSeller && (
        <AllocatePoints
          seller={selectedSeller}
          sellerManagerId={currentUser.userId}
          eventId={eventId}
          maxPerAllocation={eventData?.pointAllocationRules?.sellerManager?.maxPerAllocation || 100}
          warningThreshold={eventData?.pointAllocationRules?.sellerManager?.warningThreshold || 0.3}
          onClose={() => {
            setShowAllocatePoints(false);
            setSelectedSeller(null);
          }}
        />
      )}
    </div>
  );
};

// === 样式 ===
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
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
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
    alignItems: 'center'
  },
  userInfo: {
    padding: '0.5rem 1rem',
    background: '#fef3c7',
    borderRadius: '8px'
  },
  userName: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#92400e'
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
  tabBar: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
    background: 'white',
    padding: '0.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    overflowX: 'auto'
  },
  tabButton: {
    flex: 1,
    minWidth: '120px',
    padding: '0.75rem 1rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap'
  },
  tabButtonActive: {
    background: '#fef3c7',
    color: '#92400e'
  },
  tabContent: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    padding: '1.5rem',
    minHeight: '400px'
  },
  actionsBar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem'
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
  }
};

// 🎨 CSS Animation
const styleSheet = document.styleSheets[0];
if (styleSheet) {
  try {
    styleSheet.insertRule(`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `, styleSheet.cssRules.length);
  } catch (e) {
    console.warn('无法插入动画规则');
  }
}

export default SellerManagerDashboard;
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db, functions as fbFunctions, FUNCTIONS_REGION } from '../../config/firebase';
import { collection, getDocs, query, orderBy, where, doc, getDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { fetchDoc, fetchCollectionWithOrder, fetchCollectionDocs } from '../../utils/firestoreHelpers';
import CreateMerchantModal from './components/CreateMerchantModal.jsx';
import EditMerchantModal from './components/EditMerchantModal.jsx';
import MerchantDetailsModal from './components/MerchantDetailsModal.jsx';

const MerchantManagerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const functions = fbFunctions;

  // 状态管理
  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState([]);
  const [filteredMerchants, setFilteredMerchants] = useState([]);
  const [eventData, setEventData] = useState(null);
  const [organizationId, setOrganizationId] = useState('');
  const [eventId, setEventId] = useState('');
  
  // 筛选和搜索
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  const [ownerFilter, setOwnerFilter] = useState('all'); // all, assigned, unassigned
  
  // 模态框
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  
  // 统计数据
  const [statistics, setStatistics] = useState({
    totalMerchants: 0,
    activeMerchants: 0,
    totalRevenue: 0,
    todayRevenue: 0,
    withAsists: 0,
    totalAsists: 0
  });

  // 可用的 merchantOwners 和 merchantAsists
  const [availableOwners, setAvailableOwners] = useState([]);
  const [availableAsists, setAvailableAsists] = useState([]);

  // 加载数据
  useEffect(() => {
    if (orgEventCode) {
      loadEventData();
    }
  }, [orgEventCode]);

  useEffect(() => {
    if (organizationId && eventId) {
      loadMerchants();
      loadAvailableUsers();
    }
  }, [organizationId, eventId]);

  // 筛选摊位
  useEffect(() => {
    filterMerchants();
  }, [merchants, searchTerm, statusFilter, ownerFilter]);

  // ============================================
  // 加载活动数据
  // ============================================
  const loadEventData = async () => {
    try {
      setLoading(true);
      
      if (!orgEventCode) {
        throw new Error('缺少 orgEventCode');
      }
      
      const [orgId, evtId] = orgEventCode.split('-');
      if (!orgId || !evtId) {
        throw new Error('無效的 orgEventCode 格式');
      }
      
      setOrganizationId(orgId);
      setEventId(evtId);
      
      // 使用安全助手加载活动信息
      const eventData = await fetchDoc('organizations', orgId, 'events', evtId);
      
      if (eventData) {
        setEventData(eventData);
      }
    } catch (error) {
      console.error('加载活动数据失败:', error);
      alert('加载活动数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 加载摊位列表
  // ============================================
  const loadMerchants = async () => {
    try {
      // 防禦性檢查
      if (!organizationId || !eventId) {
        console.warn('缺少必要参数:', { organizationId, eventId });
        return;
      }
      
      // 使用安全助手加载摊位列表
      const merchantsList = await fetchCollectionWithOrder(
        { field: 'metadata.createdAt', direction: 'desc' },
        'organizations',
        organizationId,
        'events',
        eventId,
        'merchants'
      );
      
      setMerchants(merchantsList);
      calculateStatistics(merchantsList);
    } catch (error) {
      console.error('加载摊位列表失败:', error);
      alert('加载摊位列表失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 加载可用的 owners 和 asists
  // ============================================
  const loadAvailableUsers = async () => {
    try {
      // 防禦性檢查
      if (!organizationId || !eventId) {
        console.warn('缺少必要参数:', { organizationId, eventId });
        return;
      }
      
      // 使用安全助手加载用户列表
      const users = await fetchCollectionDocs(
        'organizations',
        organizationId,
        'events',
        eventId,
        'users'
      );
      
      // 筛选 merchantOwner（未被分配的）
      const owners = users.filter(user => 
        user.roles?.includes('merchantOwner') &&
        !user.merchantOwner?.merchantId
      );
      
      // 筛选 merchantAsist（所有）
      const asists = users.filter(user => 
        user.roles?.includes('merchantAsist')
      );
      
      setAvailableOwners(owners);
      setAvailableAsists(asists);
    } catch (error) {
      console.error('加载用户列表失败:', error);
    }
  };

  // ============================================
  // 计算统计数据
  // ============================================
  const calculateStatistics = (merchantsList) => {
    const stats = {
      totalMerchants: merchantsList.length,
      activeMerchants: merchantsList.filter(m => m.operationStatus?.isActive).length,
      totalRevenue: merchantsList.reduce((sum, m) => sum + (m.revenueStats?.totalRevenue || 0), 0),
      todayRevenue: merchantsList.reduce((sum, m) => sum + (m.dailyRevenue?.today || 0), 0),
      withAsists: merchantsList.filter(m => (m.merchantAsistsCount || 0) > 0).length,
      totalAsists: merchantsList.reduce((sum, m) => sum + (m.merchantAsistsCount || 0), 0)
    };
    setStatistics(stats);
  };

  // ============================================
  // 筛选摊位
  // ============================================
  const filterMerchants = () => {
    let filtered = [...merchants];
    
    // 搜索
    if (searchTerm) {
      filtered = filtered.filter(m => 
        m.stallName?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // 营业状态筛选
    if (statusFilter !== 'all') {
      filtered = filtered.filter(m => {
        if (statusFilter === 'active') return m.operationStatus?.isActive === true;
        if (statusFilter === 'inactive') return m.operationStatus?.isActive === false;
        return true;
      });
    }
    
    // 摊主筛选
    if (ownerFilter !== 'all') {
      filtered = filtered.filter(m => {
        if (ownerFilter === 'assigned') return m.merchantOwnerId != null;
        if (ownerFilter === 'unassigned') return m.merchantOwnerId == null;
        return true;
      });
    }
    
    setFilteredMerchants(filtered);
  };

  // ============================================
  // 创建摊位
  // ============================================
  const handleCreateMerchant = async (merchantData) => {
    try {
      const createMerchant = httpsCallable(functions, 'createMerchantHttp');
      
      const result = await createMerchant({
        organizationId,
        eventId,
        ...merchantData
      });
      
      console.log('创建摊位成功:', result.data);
      alert('摊位创建成功！');
      setShowCreateModal(false);
      loadMerchants(); // 刷新列表
      loadAvailableUsers(); // 刷新可用用户
    } catch (error) {
      console.error('创建摊位失败:', error);
      alert('创建摊位失败: ' + error.message);
    }
  };

  // ============================================
  // 更新摊位
  // ============================================
  const handleUpdateMerchant = async (merchantId, updates) => {
    try {
      const updateMerchant = httpsCallable(functions, 'updateMerchantHttp');
      
      const result = await updateMerchant({
        organizationId,
        eventId,
        merchantId,
        updates
      });
      
      console.log('更新摊位成功:', result.data);
      alert('摊位更新成功！');
      setShowEditModal(false);
      loadMerchants(); // 刷新列表
      loadAvailableUsers(); // 刷新可用用户
    } catch (error) {
      console.error('更新摊位失败:', error);
      alert('更新摊位失败: ' + error.message);
    }
  };

  // ============================================
  // 切换营业状态
  // ============================================
  const handleToggleStatus = async (merchantId, isActive, pauseReason = '') => {
    try {
      const toggleStatus = httpsCallable(functions, 'toggleMerchantStatusHttp');
      
      const result = await toggleStatus({
        organizationId,
        eventId,
        merchantId,
        isActive,
        pauseReason
      });
      
      console.log('状态切换成功:', result.data);
      alert(result.data.message);
      loadMerchants(); // 刷新列表
    } catch (error) {
      console.error('状态切换失败:', error);
      alert('状态切换失败: ' + error.message);
    }
  };

  // ============================================
  // 删除摊位
  // ============================================
  const handleDeleteMerchant = async (merchantId) => {
    if (!confirm('确定要删除这个摊位吗？\n\n这将是软删除，数据会保留。')) {
      return;
    }
    
    try {
      const deleteMerchant = httpsCallable(functions, 'deleteMerchantHttp');
      
      const result = await deleteMerchant({
        organizationId,
        eventId,
        merchantId,
        hardDelete: false,
        deleteReason: '管理员删除'
      });
      
      console.log('删除摊位成功:', result.data);
      alert('摊位已删除！');
      loadMerchants(); // 刷新列表
      loadAvailableUsers(); // 刷新可用用户
    } catch (error) {
      console.error('删除摊位失败:', error);
      alert('删除摊位失败: ' + error.message);
    }
  };

  // ============================================
  // 打开编辑模态框
  // ============================================
  const handleEditClick = (merchant) => {
    setSelectedMerchant(merchant);
    setShowEditModal(true);
  };

  // ============================================
  // 打开详情模态框
  // ============================================
  const handleDetailsClick = (merchant) => {
    setSelectedMerchant(merchant);
    setShowDetailsModal(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('merchantManagerInfo');
      localStorage.removeItem('currentUser');
      navigate(`/login/${orgEventCode}`, { replace: true });
    } catch (error) {
      console.error('[MerchantManager] 登出失败:', error);
      alert('登出失败，请重试');
    }
  };

  // ============================================
  // 渲染
  // ============================================
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 顶部标题栏 */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>摊位管理</h1>
          <p style={styles.subtitle}>
            {eventData?.eventName} - {eventData?.eventDate}
          </p>
        </div>
        <button
          onClick={handleLogout}
          style={styles.backButton}
        >
          ←登出
        </button>
      </div>

      {/* 统计面板 */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🏪</div>
          <div>
            <div style={styles.statValue}>{statistics.totalMerchants}</div>
            <div style={styles.statLabel}>摊位总数</div>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>✅</div>
          <div>
            <div style={styles.statValue}>{statistics.activeMerchants}</div>
            <div style={styles.statLabel}>营业中</div>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>💰</div>
          <div>
            <div style={styles.statValue}>{statistics.totalRevenue.toLocaleString()}</div>
            <div style={styles.statLabel}>总收入</div>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>📈</div>
          <div>
            <div style={styles.statValue}>{statistics.todayRevenue.toLocaleString()}</div>
            <div style={styles.statLabel}>今日收入</div>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>👥</div>
          <div>
            <div style={styles.statValue}>{statistics.totalAsists}</div>
            <div style={styles.statLabel}>助理总数</div>
          </div>
        </div>
        
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🤝</div>
          <div>
            <div style={styles.statValue}>{statistics.withAsists}</div>
            <div style={styles.statLabel}>配有助理</div>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div style={styles.toolbar}>
        <button
          onClick={() => setShowCreateModal(true)}
          style={styles.createButton}
        >
          ➕ 创建摊位
        </button>
        
        <div style={styles.filters}>
          {/* 搜索 */}
          <input
            type="text"
            placeholder="搜索摊位名称..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          
          {/* 营业状态筛选 */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部状态</option>
            <option value="active">营业中</option>
            <option value="inactive">已暂停</option>
          </select>
          
          {/* 摊主筛选 */}
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部摊位</option>
            <option value="assigned">已指定摊主</option>
            <option value="unassigned">未指定摊主</option>
          </select>
          
          {/* 刷新按钮 */}
          <button
            onClick={loadMerchants}
            style={styles.refreshButton}
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* 摊位列表 */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>#</th>
              <th style={styles.th}>摊位名称</th>
              <th style={styles.th}>摊主</th>
              <th style={styles.th}>助理数</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>总收入</th>
              <th style={styles.th}>今日收入</th>
              <th style={styles.th}>交易数</th>
              <th style={styles.th}>联系电话</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredMerchants.length === 0 ? (
              <tr>
                <td colSpan="10" style={styles.emptyCell}>
                  {searchTerm || statusFilter !== 'all' || ownerFilter !== 'all'
                    ? '没有符合条件的摊位'
                    : '还没有摊位，点击"创建摊位"开始'}
                </td>
              </tr>
            ) : (
              filteredMerchants.map((merchant, index) => (
                <tr key={merchant.id} style={styles.tableRow}>
                  <td style={styles.td}>{index + 1}</td>
                  <td style={styles.td}>
                    <strong>{merchant.stallName}</strong>
                    {merchant.description && (
                      <div style={styles.description}>{merchant.description}</div>
                    )}
                  </td>
                  <td style={styles.td}>
                    {merchant.merchantOwnerId ? (
                      <span style={styles.ownerBadge}>已分配</span>
                    ) : (
                      <span style={styles.unassignedBadge}>未分配</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.asistCount}>
                      {merchant.merchantAsistsCount || 0} / 5
                    </span>
                  </td>
                  <td style={styles.td}>
                    {merchant.operationStatus?.isActive ? (
                      <span style={styles.activeBadge}>营业中</span>
                    ) : (
                      <span style={styles.inactiveBadge}>已暂停</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    {(merchant.revenueStats?.totalRevenue || 0).toLocaleString()}
                  </td>
                  <td style={styles.td}>
                    {(merchant.dailyRevenue?.today || 0).toLocaleString()}
                  </td>
                  <td style={styles.td}>
                    {merchant.revenueStats?.transactionCount || 0}
                  </td>
                  <td style={styles.td}>
                    {merchant.contactInfo?.phone || '-'}
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button
                        onClick={() => handleDetailsClick(merchant)}
                        style={styles.actionButton}
                        title="查看详情"
                      >
                        👁️
                      </button>
                      <button
                        onClick={() => handleEditClick(merchant)}
                        style={styles.actionButton}
                        title="编辑"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleToggleStatus(
                          merchant.id,
                          !merchant.operationStatus?.isActive,
                          merchant.operationStatus?.isActive ? '临时休息' : ''
                        )}
                        style={styles.actionButton}
                        title={merchant.operationStatus?.isActive ? '暂停营业' : '恢复营业'}
                      >
                        {merchant.operationStatus?.isActive ? '⏸️' : '▶️'}
                      </button>
                      <button
                        onClick={() => handleDeleteMerchant(merchant.id)}
                        style={styles.deleteButton}
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建摊位模态框 */}
      {showCreateModal && (
        <CreateMerchantModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateMerchant}
          availableOwners={availableOwners}
          availableAsists={availableAsists}
        />
      )}

      {/* 编辑摊位模态框 */}
      {showEditModal && selectedMerchant && (
        <EditMerchantModal
          merchant={selectedMerchant}
          onClose={() => {
            setShowEditModal(false);
            setSelectedMerchant(null);
          }}
          onSubmit={handleUpdateMerchant}
          availableOwners={availableOwners}
          availableAsists={availableAsists}
        />
      )}

      {/* 摊位详情模态框 */}
      {showDetailsModal && selectedMerchant && (
        <MerchantDetailsModal
          merchant={selectedMerchant}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedMerchant(null);
          }}
        />
      )}
    </div>
  );
};

// ============================================
// 样式
// ============================================
const styles = {
  container: {
    padding: '2rem',
    maxWidth: '1600px',
    margin: '0 auto',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '1rem'
  },
  spinner: {
    width: '50px',
    height: '50px',
    border: '5px solid #f3f3f3',
    borderTop: '5px solid #8b5cf6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem',
    backgroundColor: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '2rem',
    fontWeight: '700',
    color: '#1f2937',
    margin: 0
  },
  subtitle: {
    fontSize: '1rem',
    color: '#6b7280',
    margin: '0.5rem 0 0 0'
  },
  backButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  statCard: {
    backgroundColor: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  statIcon: {
    fontSize: '2.5rem'
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  statLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  createButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    boxShadow: '0 2px 4px rgba(139,92,246,0.3)'
  },
  filters: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  searchInput: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    minWidth: '250px'
  },
  filterSelect: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    backgroundColor: 'white',
    cursor: 'pointer'
  },
  refreshButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500'
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeader: {
    backgroundColor: '#f9fafb'
  },
  th: {
    padding: '1rem',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb'
  },
  td: {
    padding: '1rem',
    color: '#1f2937'
  },
  emptyCell: {
    padding: '3rem',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '1.125rem'
  },
  description: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  ownerBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  unassignedBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  asistCount: {
    fontWeight: '500'
  },
  activeBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  inactiveBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#f3f4f6',
    color: '#4b5563',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  actions: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionButton: {
    padding: '0.5rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1.125rem'
  },
  deleteButton: {
    padding: '0.5rem',
    backgroundColor: '#fee2e2',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1.125rem'
  }
};

export default MerchantManagerDashboard;

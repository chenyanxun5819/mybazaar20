/**
 * Allocation History Component
 * 
 * 显示 Seller Manager 的点数分配历史记录
 * 
 * Features:
 * - 实时监听分配记录
 * - 日期筛选（今天、最近7天、最近30天、全部）
 * - 部门筛选
 * - 姓名搜索
 * - 统计摘要
 * - 分页加载（每次50条）
 * 
 * @version 2025-01-11
 */

import { useState, useEffect } from 'react';
import { db } from '../../../config/firebase';
import { collection, query, orderBy, limit, where, onSnapshot, Timestamp } from 'firebase/firestore';

const AllocationHistory = ({
  organizationId,
  eventId,
  sellerManagerId,
  managedDepartments = []
}) => {
  // ===================================================================
  // 状态管理
  // ===================================================================
  const [allocations, setAllocations] = useState([]);
  const [filteredAllocations, setFilteredAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 筛选条件
  const [dateFilter, setDateFilter] = useState('all'); // 'today' | 'week' | 'month' | 'all'
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' | 'asc'

  // 统计数据
  const [stats, setStats] = useState({
    totalAllocations: 0,
    totalPoints: 0,
    averagePoints: 0,
    lastAllocationTime: null
  });

  // ===================================================================
  // 实时监听分配记录
  // ===================================================================
  useEffect(() => {
    if (!organizationId || !eventId || !sellerManagerId) {
      console.warn('[AllocationHistory] 缺少必填参数');
      setLoading(false);
      return;
    }

    console.log('[AllocationHistory] 开始监听分配记录', {
      organizationId,
      eventId,
      sellerManagerId
    });

    const allocationsRef = collection(
      db,
      `organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}/pointAllocations`
    );

    // 构建查询（按时间倒序，限制100条）
    const q = query(
      allocationsRef,
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    // 设置实时监听
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        console.log(`[AllocationHistory] ✅ 查询到 ${snapshot.size} 条记录`);

        const allocationsList = [];
        snapshot.forEach(doc => {
          allocationsList.push({
            id: doc.id,
            ...doc.data()
          });
        });

        setAllocations(allocationsList);
        setLoading(false);
        setError(null);

        // 计算统计数据
        if (allocationsList.length > 0) {
          const totalPoints = allocationsList.reduce((sum, a) => sum + (a.points || 0), 0);
          const lastAllocation = allocationsList[0]; // 已经按时间倒序

          setStats({
            totalAllocations: allocationsList.length,
            totalPoints,
            averagePoints: Math.round(totalPoints / allocationsList.length),
            lastAllocationTime: lastAllocation.createdAt
          });
        } else {
          setStats({
            totalAllocations: 0,
            totalPoints: 0,
            averagePoints: 0,
            lastAllocationTime: null
          });
        }
      },
      (err) => {
        console.error('[AllocationHistory] ❌ 查询错误', err);
        setError(err.message);
        setLoading(false);
      }
    );

    // 清理函数
    return () => {
      console.log('[AllocationHistory] 停止监听');
      unsubscribe();
    };
  }, [organizationId, eventId, sellerManagerId]);

  // ===================================================================
  // 筛选和搜索逻辑
  // ===================================================================
  useEffect(() => {
    let filtered = [...allocations];

    // 日期筛选
    if (dateFilter !== 'all') {
      const now = new Date();
      let startDate = new Date();

      if (dateFilter === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (dateFilter === 'week') {
        startDate.setDate(now.getDate() - 7);
      } else if (dateFilter === 'month') {
        startDate.setDate(now.getDate() - 30);
      }

      filtered = filtered.filter(a => {
        if (!a.createdAt) return false;
        const createdDate = a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        return createdDate >= startDate;
      });
    }

    // 部门筛选
    if (departmentFilter !== 'all') {
      filtered = filtered.filter(a => a.recipientDepartment === departmentFilter);
    }

    // 姓名搜索
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(a => {
        const name = (a.recipientName || '').toLowerCase();
        const id = (a.recipientId || '').toLowerCase();
        return name.includes(query) || id.includes(query);
      });
    }

    // 排序
    if (sortOrder === 'asc') {
      filtered.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return aTime - bTime;
      });
    }

    setFilteredAllocations(filtered);
  }, [allocations, dateFilter, departmentFilter, searchQuery, sortOrder]);

  // ===================================================================
  // 辅助函数
  // ===================================================================

  /**
   * 格式化时间
   */
  const formatTime = (timestamp) => {
    if (!timestamp) return '-';

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays < 7) return `${diffDays} 天前`;

    return date.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * 格式化完整日期
   */
  const formatFullDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  /**
   * 重置筛选
   */
  const resetFilters = () => {
    setDateFilter('all');
    setDepartmentFilter('all');
    setSearchQuery('');
    setSortOrder('desc');
  };

  // ===================================================================
  // 渲染
  // ===================================================================

  // 加载状态
  if (loading) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.spinner}></div>
        <p>加载分配历史...</p>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>❌</div>
        <h3>加载失败</h3>
        <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 统计摘要 */}
      <div style={styles.statsSection}>
        <h3 style={styles.statsTitle}>📊 统计摘要</h3>
        <div style={styles.statsGrid}>
          <StatCard
            icon="📦"
            label="总分配次数"
            value={stats.totalAllocations}
            color="#3b82f6"
          />
          <StatCard
            icon="💰"
            label="总分配点数"
            value={stats.totalPoints.toLocaleString()}
            color="#8b5cf6"
          />
          <StatCard
            icon="📊"
            label="平均每次"
            value={stats.averagePoints}
            color="#06b6d4"
          />
          <StatCard
            icon="🕐"
            label="最近分配"
            value={formatTime(stats.lastAllocationTime)}
            color="#10b981"
          />
        </div>
      </div>

      {/* 筛选栏 */}
      <div style={styles.filterSection}>
        <h3 style={styles.filterTitle}>🔍 筛选和搜索</h3>
        <div style={styles.filterGrid}>
          {/* 日期筛选 */}
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>日期范围：</label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">全部</option>
              <option value="today">今天</option>
              <option value="week">最近7天</option>
              <option value="month">最近30天</option>
            </select>
          </div>

          {/* 部门筛选 */}
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>部门：</label>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">全部</option>
              {managedDepartments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>

          {/* 排序 */}
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>排序：</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="desc">最新优先</option>
              <option value="asc">最旧优先</option>
            </select>
          </div>

          {/* 搜索框 */}
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>搜索：</label>
            <input
              type="text"
              placeholder="搜索Seller姓名或ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>
        </div>

        <div style={styles.filterActions}>
          <button onClick={resetFilters} style={styles.resetButton}>
            🔄 重置筛选
          </button>
          <div style={styles.resultCount}>
            显示 {filteredAllocations.length} / {allocations.length} 条记录
          </div>
        </div>
      </div>

      {/* 分配记录列表 */}
      <div style={styles.listSection}>
        <h3 style={styles.listTitle}>📋 分配记录</h3>

        {filteredAllocations.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📭</div>
            <h3>没有找到记录</h3>
            <p>
              {allocations.length === 0 
                ? '您还没有进行过点数分配' 
                : '没有符合筛选条件的记录，请调整筛选条件'}
            </p>
          </div>
        ) : (
          <div style={styles.allocationsList}>
            {filteredAllocations.map((allocation) => (
              <AllocationCard
                key={allocation.id}
                allocation={allocation}
                formatTime={formatTime}
                formatFullDate={formatFullDate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ===================================================================
// 子组件：统计卡片
// ===================================================================
const StatCard = ({ icon, label, value, color }) => {
  return (
    <div style={{ ...styles.statCard, borderLeftColor: color }}>
      <div style={styles.statIcon}>{icon}</div>
      <div style={styles.statContent}>
        <div style={styles.statValue}>{value}</div>
        <div style={styles.statLabel}>{label}</div>
      </div>
    </div>
  );
};

// ===================================================================
// 子组件：分配记录卡片
// ===================================================================
const AllocationCard = ({ allocation, formatTime, formatFullDate }) => {
  const [showDetails, setShowDetails] = useState(false);

  const statusColor = {
    completed: '#10b981',
    pending: '#f59e0b',
    failed: '#ef4444'
  }[allocation.status] || '#6b7280';

  const statusText = {
    completed: '✅ 已完成',
    pending: '⏳ 处理中',
    failed: '❌ 失败'
  }[allocation.status] || '未知';

  return (
    <div style={styles.allocationCard}>
      {/* 头部 */}
      <div style={styles.cardHeader}>
        <div style={styles.cardTime}>
          🕐 {formatTime(allocation.createdAt)}
        </div>
        <div style={{ ...styles.cardStatus, color: statusColor }}>
          {statusText}
        </div>
      </div>

      {/* 主要信息 */}
      <div style={styles.cardMain}>
        <div style={styles.cardRecipient}>
          <div style={styles.cardIcon}>
            {(allocation.recipientName?.[0] || '?').toUpperCase()}
          </div>
          <div style={styles.cardRecipientInfo}>
            <div style={styles.cardRecipientName}>
              {allocation.recipientName || '未知'}
            </div>
            <div style={styles.cardRecipientMeta}>
              🏫 {allocation.recipientDepartment || '未知部门'}
            </div>
          </div>
        </div>

        <div style={styles.cardPoints}>
          <div style={styles.cardPointsValue}>
            +{allocation.points || 0}
          </div>
          <div style={styles.cardPointsLabel}>点</div>
        </div>
      </div>

      {/* 备注 */}
      {allocation.notes && (
        <div style={styles.cardNotes}>
          <strong>备注：</strong> {allocation.notes}
        </div>
      )}

      {/* 展开/收起按钮 */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        style={styles.toggleButton}
      >
        {showDetails ? '▲ 收起详情' : '▼ 查看详情'}
      </button>

      {/* 详情 */}
      {showDetails && (
        <div style={styles.cardDetails}>
          <div style={styles.detailRow}>
            <span>分配时间：</span>
            <strong>{formatFullDate(allocation.createdAt)}</strong>
          </div>
          <div style={styles.detailRow}>
            <span>接收者ID：</span>
            <strong>{allocation.recipientId}</strong>
          </div>
          <div style={styles.detailRow}>
            <span>分配者：</span>
            <strong>{allocation.allocatedByName || '未知'}</strong>
          </div>
          {allocation.recipientStatsSnapshot && (
            <>
              <div style={styles.detailDivider}></div>
              <div style={styles.detailSubtitle}>📸 分配时快照</div>
              <div style={styles.detailRow}>
                <span>分配前余额：</span>
                <strong>{(allocation.recipientStatsSnapshot.beforeBalance || 0).toLocaleString()}</strong>
              </div>
              <div style={styles.detailRow}>
                <span>累计销售额：</span>
                <strong>{(allocation.recipientStatsSnapshot.beforeTotalRevenue || 0).toLocaleString()}</strong>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ===================================================================
// 样式
// ===================================================================
const styles = {
  container: {
    padding: '0'
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
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #f59e0b',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 1rem'
  },

  // 统计摘要
  statsSection: {
    marginBottom: '2rem'
  },
  statsTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '1rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem'
  },
  statCard: {
    background: '#fafafa',
    padding: '1.25rem',
    borderRadius: '12px',
    borderLeft: '4px solid',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  statIcon: {
    fontSize: '2rem'
  },
  statContent: {
    flex: 1
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  statLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },

  // 筛选栏
  filterSection: {
    background: '#fafafa',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '2rem',
    border: '2px solid #e5e7eb'
  },
  filterTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '1rem'
  },
  filterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem'
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  filterLabel: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  filterSelect: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    background: 'white',
    cursor: 'pointer'
  },
  searchInput: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    outline: 'none'
  },
  filterActions: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  resetButton: {
    padding: '0.5rem 1rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151'
  },
  resultCount: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },

  // 列表
  listSection: {
    marginBottom: '2rem'
  },
  listTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '1rem'
  },
  allocationsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },

  // 分配卡片
  allocationCard: {
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid #e5e7eb'
  },
  cardTime: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  cardStatus: {
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  cardMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  cardRecipient: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
    flex: 1
  },
  cardIcon: {
    width: '50px',
    height: '50px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.25rem',
    fontWeight: 'bold'
  },
  cardRecipientInfo: {
    flex: 1
  },
  cardRecipientName: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  cardRecipientMeta: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  cardPoints: {
    textAlign: 'right'
  },
  cardPointsValue: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#10b981'
  },
  cardPointsLabel: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  cardNotes: {
    background: '#f9fafb',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    color: '#374151',
    marginBottom: '1rem'
  },
  toggleButton: {
    width: '100%',
    padding: '0.75rem',
    background: '#f3f4f6',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  cardDetails: {
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: '1px solid #e5e7eb'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
  },
  detailDivider: {
    height: '1px',
    background: '#e5e7eb',
    margin: '0.75rem 0'
  },
  detailSubtitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  }
};

// 添加旋转动画
const styleSheet = document.styleSheets[0];
if (styleSheet) {
  try {
    styleSheet.insertRule(
      `@keyframes spin { to { transform: rotate(360deg); } }`,
      styleSheet.cssRules.length
    );
  } catch (e) {
    // Ignore if already exists
  }
}

export default AllocationHistory;

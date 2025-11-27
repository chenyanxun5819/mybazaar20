import { useState } from 'react';

/**
 * Seller List Component (重构版)
 * 
 * @description
 * 显示 Seller Manager 管理的所有 Sellers
 * 
 * 新特性：
 * 1. 支持所有 identityTag（student, teacher, parent, staff, volunteer, external）
 * 2. 使用新的 pointsStats 字段
 * 3. 显示收款警示
 * 4. 显示点数来源（从 EM 还是 SM）
 * 
 * @param {Array} sellers - Sellers 列表
 * @param {Function} onAllocatePoints - 分配点数回调
 * @param {number} maxPerAllocation - 每次分配上限
 */
const SellerList = ({ sellers, onAllocatePoints, maxPerAllocation }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name'); // name | balance | revenue | collectionRate | alert
  const [filterTag, setFilterTag] = useState('all'); // all | student | teacher | staff | parent | volunteer | external
  const [filterAlert, setFilterAlert] = useState('all'); // all | warning | none

  /**
   * 过滤和排序 Sellers
   */
  const getFilteredAndSortedSellers = () => {
    let filtered = sellers;

    // 🔍 搜索过滤
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = sellers.filter(seller => {
        const displayName = seller.displayName?.toLowerCase() || '';
        const department = seller.department?.toLowerCase() || '';
        const email = seller.email?.toLowerCase() || '';
        
        return displayName.includes(search) || 
               department.includes(search) || 
               email.includes(search);
      });
    }

    // 🏷️ identityTag 过滤
    if (filterTag !== 'all') {
      filtered = filtered.filter(seller => seller.identityTag === filterTag);
    }

    // ⚠️ 警示过滤
    if (filterAlert !== 'all') {
      if (filterAlert === 'warning') {
        filtered = filtered.filter(seller => seller.collectionAlert?.hasWarning === true);
      } else {
        filtered = filtered.filter(seller => !seller.collectionAlert?.hasWarning);
      }
    }

    // 📊 排序
    const sorted = [...filtered].sort((a, b) => {
      const aStats = a.pointsStats || {};
      const bStats = b.pointsStats || {};

      switch (sortBy) {
        case 'balance':
          return (bStats.currentBalance || 0) - (aStats.currentBalance || 0);
        case 'revenue':
          return (bStats.totalRevenue || 0) - (aStats.totalRevenue || 0);
        case 'collectionRate':
          return (bStats.collectionRate || 0) - (aStats.collectionRate || 0);
        case 'alert':
          // 有警示的排在前面
          const aHasAlert = a.collectionAlert?.hasWarning ? 1 : 0;
          const bHasAlert = b.collectionAlert?.hasWarning ? 1 : 0;
          return bHasAlert - aHasAlert;
        case 'name':
        default:
          return (a.displayName || '').localeCompare(b.displayName || '');
      }
    });

    return sorted;
  };

  const filteredSellers = getFilteredAndSortedSellers();

  // 统计各 identityTag 数量
  const tagCounts = sellers.reduce((acc, seller) => {
    const tag = seller.identityTag || 'unknown';
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {});

  // 统计警示数量
  const alertCount = sellers.filter(s => s.collectionAlert?.hasWarning).length;

  return (
    <div style={styles.container}>
      {/* 🔍 搜索栏 */}
      <div style={styles.searchBox}>
        <span style={styles.searchIcon}>🔍</span>
        <input
          type="text"
          placeholder="搜索姓名、部门、邮箱..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
        {searchTerm && (
          <button
            style={styles.clearButton}
            onClick={() => setSearchTerm('')}
          >
            ✕
          </button>
        )}
      </div>

      {/* 🏷️ 筛选和排序栏 */}
      <div style={styles.toolbar}>
        {/* identityTag 筛选 */}
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>身份:</label>
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部 ({sellers.length})</option>
            <option value="student">学生 ({tagCounts.student || 0})</option>
            <option value="teacher">老师 ({tagCounts.teacher || 0})</option>
            <option value="staff">职员 ({tagCounts.staff || 0})</option>
            <option value="parent">家长 ({tagCounts.parent || 0})</option>
            <option value="volunteer">义工 ({tagCounts.volunteer || 0})</option>
            <option value="external">外部 ({tagCounts.external || 0})</option>
          </select>
        </div>

        {/* 警示筛选 */}
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>警示:</label>
          <select
            value={filterAlert}
            onChange={(e) => setFilterAlert(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部</option>
            <option value="warning">有警示 ({alertCount})</option>
            <option value="none">无警示</option>
          </select>
        </div>

        {/* 排序 */}
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>排序:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="name">姓名 A-Z</option>
            <option value="balance">持有点数（高到低）</option>
            <option value="revenue">销售额（高到低）</option>
            <option value="collectionRate">收款率（高到低）</option>
            <option value="alert">警示优先</option>
          </select>
        </div>
      </div>

      {/* 📊 Sellers Grid */}
      {filteredSellers.length === 0 ? (
        <div style={styles.emptyState}>
          {searchTerm || filterTag !== 'all' || filterAlert !== 'all' ? (
            <>
              <div style={styles.emptyIcon}>🔍</div>
              <h3>找不到匹配的 Seller</h3>
              <p>试试调整筛选条件</p>
            </>
          ) : (
            <>
              <div style={styles.emptyIcon}>📝</div>
              <h3>还没有 Seller</h3>
              <p>请先创建 Seller 用户</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            {filteredSellers.map(seller => (
              <SellerCard
                key={seller.id}
                seller={seller}
                onAllocatePoints={onAllocatePoints}
                maxPerAllocation={maxPerAllocation}
              />
            ))}
          </div>
          <div style={styles.resultStats}>
            显示 {filteredSellers.length} / {sellers.length} 位 Seller
          </div>
        </>
      )}
    </div>
  );
};

/**
 * 单个 Seller 卡片组件
 */
const SellerCard = ({ seller, onAllocatePoints, maxPerAllocation }) => {
  const pointsStats = seller.pointsStats || {};
  const collectionAlert = seller.collectionAlert || {};

  // identityTag 图标和颜色
  const getTagInfo = (tag) => {
    const tagMap = {
      student: { icon: '🎓', label: '学生', color: '#3b82f6' },
      teacher: { icon: '👨‍🏫', label: '老师', color: '#8b5cf6' },
      staff: { icon: '👔', label: '职员', color: '#06b6d4' },
      parent: { icon: '👨‍👩‍👧', label: '家长', color: '#10b981' },
      volunteer: { icon: '🤝', label: '义工', color: '#f59e0b' },
      external: { icon: '🌐', label: '外部', color: '#6b7280' }
    };
    return tagMap[tag] || { icon: '❓', label: '未知', color: '#9ca3af' };
  };

  const tagInfo = getTagInfo(seller.identityTag);

  // 收款率颜色
  const collectionRate = pointsStats.collectionRate || 0;
  const getRateColor = (rate) => {
    if (rate >= 0.8) return '#10b981';
    if (rate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  // 警示等级样式
  const getAlertStyle = (level) => {
    const levelMap = {
      high: { bg: '#fee2e2', color: '#991b1b', label: '⚠️ 高风险' },
      medium: { bg: '#fed7aa', color: '#9a3412', label: '⚠️ 中等' },
      low: { bg: '#fef3c7', color: '#92400e', label: '⚠️ 注意' },
      none: { bg: '#d1fae5', color: '#065f46', label: '✓ 正常' }
    };
    return levelMap[level] || levelMap.none;
  };

  const alertStyle = getAlertStyle(collectionAlert.warningLevel || 'none');

  return (
    <div
      style={styles.card}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      }}
    >
      {/* 用户头部信息 */}
      <div style={styles.cardHeader}>
        <div style={{
          ...styles.avatar,
          background: tagInfo.color
        }}>
          {(seller.displayName || '?')[0].toUpperCase()}
        </div>
        <div style={styles.cardHeaderInfo}>
          <h3 style={styles.sellerName}>
            {seller.displayName || 'N/A'}
          </h3>
          <div style={styles.sellerMeta}>
            <span style={{
              ...styles.tagBadge,
              background: tagInfo.color
            }}>
              {tagInfo.icon} {tagInfo.label}
            </span>
            <span style={styles.department}>
              📍 {seller.department || '无部门'}
            </span>
          </div>
        </div>
        
        {/* 警示状态 */}
        <div style={{
          ...styles.alertBadge,
          background: alertStyle.bg,
          color: alertStyle.color
        }}>
          {alertStyle.label}
        </div>
      </div>

      {/* 统计信息 */}
      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <div style={styles.statLabel}>持有点数</div>
          <div style={styles.statValue}>
            RM {(pointsStats.currentBalance || 0).toLocaleString()}
          </div>
        </div>
        <div style={styles.statDivider}></div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>累计销售</div>
          <div style={styles.statValue}>
            RM {(pointsStats.totalRevenue || 0).toLocaleString()}
          </div>
        </div>
        <div style={styles.statDivider}></div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>收款率</div>
          <div style={{
            ...styles.statValue,
            color: getRateColor(collectionRate)
          }}>
            {Math.round(collectionRate * 100)}%
          </div>
        </div>
      </div>

      {/* 收款详情 */}
      <div style={styles.collectionRow}>
        <div style={styles.collectionItem}>
          <span style={styles.collectionLabel}>已收款:</span>
          <span style={{ ...styles.collectionValue, color: '#10b981' }}>
            RM {(pointsStats.totalCollected || 0).toLocaleString()}
          </span>
        </div>
        <div style={styles.collectionItem}>
          <span style={styles.collectionLabel}>待收款:</span>
          <span style={{ ...styles.collectionValue, color: '#ef4444' }}>
            RM {(pointsStats.pendingCollection || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* 点数来源 */}
      <div style={styles.sourceRow}>
        <div style={styles.sourceItem}>
          <span style={styles.sourceLabel}>来自 EM:</span>
          <span style={styles.sourceValue}>
            RM {(pointsStats.receivedFromEventManager || 0).toLocaleString()}
          </span>
        </div>
        <div style={styles.sourceItem}>
          <span style={styles.sourceLabel}>来自 SM:</span>
          <span style={styles.sourceValue}>
            RM {(pointsStats.receivedFromSellerManager || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={styles.actions}>
        <button
          style={styles.primaryActionButton}
          onClick={() => onAllocatePoints(seller)}
        >
          💰 分配点数 (上限: RM {maxPerAllocation})
        </button>
      </div>

      {/* 警示提示 */}
      {collectionAlert.hasWarning && (
        <div style={styles.warningTip}>
          ⚠️ 待收款: RM {collectionAlert.pendingAmount?.toLocaleString() || 0}
          <br />
          <small>建议先收款再分配新点数</small>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    width: '100%'
  },
  searchBox: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '0 1rem',
    marginBottom: '1rem'
  },
  searchIcon: {
    fontSize: '1.25rem',
    marginRight: '0.5rem'
  },
  searchInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    padding: '0.75rem 0',
    fontSize: '0.875rem',
    outline: 'none'
  },
  clearButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '1.25rem',
    padding: '0.25rem'
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap'
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  filterLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  filterSelect: {
    padding: '0.5rem 0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    background: 'white'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1.5rem',
    marginBottom: '1.5rem'
  },
  card: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem',
    transition: 'all 0.2s',
    position: 'relative'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  avatar: {
    width: '60px',
    height: '60px',
    borderRadius: '12px',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 'bold',
    flexShrink: 0
  },
  cardHeaderInfo: {
    flex: 1
  },
  sellerName: {
    margin: '0 0 0.5rem 0',
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  sellerMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    alignItems: 'center'
  },
  tagBadge: {
    padding: '0.25rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'white'
  },
  department: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  alertBadge: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  statsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
    padding: '1rem',
    background: 'white',
    borderRadius: '8px'
  },
  stat: {
    flex: 1,
    textAlign: 'center'
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  statValue: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  statDivider: {
    width: '1px',
    height: '40px',
    background: '#e5e7eb'
  },
  collectionRow: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '0.75rem',
    padding: '0.75rem',
    background: 'white',
    borderRadius: '8px'
  },
  collectionItem: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  collectionLabel: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  collectionValue: {
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  sourceRow: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1rem',
    padding: '0.75rem',
    background: '#f3f4f6',
    borderRadius: '8px'
  },
  sourceItem: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sourceLabel: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  sourceValue: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.75rem'
  },
  primaryActionButton: {
    flex: 1,
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s'
  },
  warningTip: {
    background: '#fef3c7',
    border: '2px solid #fbbf24',
    color: '#92400e',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.75rem',
    textAlign: 'center'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem 1rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  resultStats: {
    textAlign: 'center',
    fontSize: '0.875rem',
    color: '#6b7280',
    padding: '1rem'
  }
};

export default SellerList;
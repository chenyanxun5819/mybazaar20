import { useState } from 'react';

/**
 * Department List Component (超级安全版 v3)
 */
const DepartmentList = ({ departmentStats, onSelectDepartment }) => {
  const [sortBy, setSortBy] = useState('revenue');
  const [showDetails, setShowDetails] = useState(null);

  // 确保输入是安全的
  const safeDepartmentStats = Array.isArray(departmentStats) ? departmentStats : [];

  const getSortedDepartments = () => {
    if (safeDepartmentStats.length === 0) return [];

    return [...safeDepartmentStats].sort((a, b) => {
      if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return 0;

      const aStats = (a.pointsStats && typeof a.pointsStats === 'object') ? a.pointsStats : {};
      const bStats = (b.pointsStats && typeof b.pointsStats === 'object') ? b.pointsStats : {};

      switch (sortBy) {
        case 'revenue':
          return (bStats.totalRevenue || 0) - (aStats.totalRevenue || 0);
        case 'collectionRate':
          return (bStats.collectionRate || 0) - (aStats.collectionRate || 0);
        case 'name':
          const aCode = a.departmentCode || '';
          const bCode = b.departmentCode || '';
          return String(aCode).localeCompare(String(bCode));
        default:
          return 0;
      }
    });
  };

  const sortedDepartments = getSortedDepartments();

  if (sortedDepartments.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>🏫</div>
        <h3>还没有部门数据</h3>
        <p>系统正在生成统计数据，请稍候</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>🏫 管理的部门 ({sortedDepartments.length})</h2>
        <div style={styles.sortBox}>
          <label style={styles.sortLabel}>排序：</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.sortSelect}
          >
            <option value="revenue">销售额（高到低）</option>
            <option value="collectionRate">收款率（高到低）</option>
            <option value="name">部门名称 A-Z</option>
          </select>
        </div>
      </div>

      <div style={styles.grid}>
        {sortedDepartments.map((dept, index) => {
          if (!dept || typeof dept !== 'object') return null;
          
          const deptId = dept.id || dept.departmentCode || `dept-${index}`;
          
          return (
            <DepartmentCard
              key={deptId}
              dept={dept}
              rank={index + 1}
              isExpanded={showDetails === deptId}
              onToggle={() => setShowDetails(showDetails === deptId ? null : deptId)}
              onSelect={onSelectDepartment}
            />
          );
        })}
      </div>
    </div>
  );
};

const DepartmentCard = ({ dept, rank, isExpanded, onToggle, onSelect }) => {
  if (!dept || typeof dept !== 'object') return null;

  const pointsStats = (dept.pointsStats && typeof dept.pointsStats === 'object') ? dept.pointsStats : {};
  const membersStats = (dept.membersStats && typeof dept.membersStats === 'object') ? dept.membersStats : {};
  const allocationStats = (dept.allocationStats && typeof dept.allocationStats === 'object') ? dept.allocationStats : {};
  const collectionAlerts = (dept.collectionAlerts && typeof dept.collectionAlerts === 'object') ? dept.collectionAlerts : {};

  const collectionRate = typeof pointsStats.collectionRate === 'number' ? pointsStats.collectionRate : 0;
  
  const getRateColor = (rate) => {
    const safeRate = typeof rate === 'number' ? rate : 0;
    if (safeRate >= 0.8) return '#10b981';
    if (safeRate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  const getRankColor = (r) => {
    if (r === 1) return '#fbbf24';
    if (r === 2) return '#9ca3af';
    if (r === 3) return '#cd7f32';
    return '#6b7280';
  };

  const departmentCode = dept.departmentCode || '未知';
  const departmentName = dept.departmentName || '未命名部门';
  const deptInitial = String(departmentCode).charAt(0) || '?';

  return (
    <div style={styles.card}>
      <div style={{ ...styles.rankBadge, background: getRankColor(rank) }}>
        #{rank}
      </div>

      <div style={styles.cardHeader}>
        <div style={styles.deptIcon}>{deptInitial}</div>
        <div style={styles.deptInfo}>
          <h3 style={styles.deptCode}>{departmentCode}</h3>
          <p style={styles.deptName}>{departmentName}</p>
          <div style={styles.memberCount}>
            👥 {membersStats.totalCount || 0} 人 
            <span style={styles.activeCount}>
              (活跃: {membersStats.activeCount || 0})
            </span>
          </div>
        </div>
      </div>

      <div style={styles.mainStats}>
        <div style={styles.mainStatItem}>
          <div style={styles.mainStatLabel}>持有点数</div>
          <div style={styles.mainStatValue}>
            RM {(pointsStats.currentBalance || 0).toLocaleString()}
          </div>
        </div>
        <div style={styles.statDivider}></div>
        <div style={styles.mainStatItem}>
          <div style={styles.mainStatLabel}>累计销售</div>
          <div style={styles.mainStatValue}>
            RM {(pointsStats.totalRevenue || 0).toLocaleString()}
          </div>
        </div>
      </div>

      <div style={styles.collectionSection}>
        <div style={styles.collectionHeader}>
          <span style={styles.collectionLabel}>收款率</span>
          <span style={{
            ...styles.collectionPercent,
            color: getRateColor(collectionRate)
          }}>
            {Math.round(collectionRate * 100)}%
          </span>
        </div>
        <div style={styles.progressBar}>
          <div style={{
            ...styles.progressFill,
            width: `${Math.min(100, collectionRate * 100)}%`,
            background: getRateColor(collectionRate)
          }}></div>
        </div>
        <div style={styles.collectionDetails}>
          <span>已收款: RM {(pointsStats.totalCollected || 0).toLocaleString()}</span>
          <span style={{ color: '#ef4444' }}>
            待收款: RM {(pointsStats.pendingCollection || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {(collectionAlerts.usersWithWarnings || 0) > 0 && (
        <div style={styles.alertBanner}>
          ⚠️ {collectionAlerts.usersWithWarnings} 位用户有收款警示
          {Array.isArray(collectionAlerts.highRiskUsers) && collectionAlerts.highRiskUsers.length > 0 && (
            <span style={styles.highRisk}>
              ({collectionAlerts.highRiskUsers.length} 高风险)
            </span>
          )}
        </div>
      )}

      <button style={styles.toggleButton} onClick={onToggle}>
        {isExpanded ? '▲ 收起详情' : '▼ 查看详情'}
      </button>

      {isExpanded && (
        <div style={styles.detailsSection}>
          <div style={styles.detailsGrid}>
            <div style={styles.detailCard}>
              <div style={styles.detailTitle}>💰 点数流动</div>
              <div style={styles.detailRow}>
                <span>累计收到:</span>
                <strong>RM {(pointsStats.totalReceived || 0).toLocaleString()}</strong>
              </div>
              <div style={styles.detailRow}>
                <span>当前持有:</span>
                <strong>RM {(pointsStats.currentBalance || 0).toLocaleString()}</strong>
              </div>
              <div style={styles.detailRow}>
                <span>累计售出:</span>
                <strong>RM {(pointsStats.totalSold || 0).toLocaleString()}</strong>
              </div>
            </div>

            <div style={styles.detailCard}>
              <div style={styles.detailTitle}>📦 分配统计</div>
              <div style={styles.detailRow}>
                <span>总分配次数:</span>
                <strong>{allocationStats.totalAllocations || 0}</strong>
              </div>
              <div style={styles.detailRow}>
                <span>来自 Event Mgr:</span>
                <strong>
                  {(allocationStats.byEventManager && typeof allocationStats.byEventManager === 'object' && allocationStats.byEventManager.count) || 0} 次
                </strong>
              </div>
              <div style={styles.detailRow}>
                <span>来自 Seller Mgr:</span>
                <strong>
                  {(allocationStats.bySellerManager && typeof allocationStats.bySellerManager === 'object' && allocationStats.bySellerManager.count) || 0} 次
                </strong>
              </div>
            </div>
          </div>

          <button
            style={styles.actionButton}
            onClick={() => onSelect && typeof onSelect === 'function' && onSelect(dept)}
          >
            👁️ 查看该部门的 Sellers
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: { width: '100%' },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  sortBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  sortLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  sortSelect: {
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
    gap: '1.5rem'
  },
  card: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem',
    position: 'relative'
  },
  rankBadge: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.875rem',
    fontWeight: 'bold',
    color: 'white'
  },
  cardHeader: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  deptIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 'bold'
  },
  deptInfo: { flex: 1 },
  deptCode: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.25rem 0'
  },
  deptName: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0 0 0.5rem 0'
  },
  memberCount: {
    fontSize: '0.875rem',
    color: '#374151',
    fontWeight: '500'
  },
  activeCount: {
    color: '#10b981',
    marginLeft: '0.25rem'
  },
  mainStats: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  mainStatItem: {
    flex: 1,
    textAlign: 'center'
  },
  mainStatLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  mainStatValue: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  statDivider: {
    width: '1px',
    background: '#e5e7eb'
  },
  collectionSection: { marginBottom: '1rem' },
  collectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem'
  },
  collectionLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  collectionPercent: {
    fontSize: '1rem',
    fontWeight: 'bold'
  },
  progressBar: {
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '0.5rem'
  },
  progressFill: {
    height: '100%',
    borderRadius: '4px'
  },
  collectionDetails: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  alertBanner: {
    background: '#fef3c7',
    border: '2px solid #fbbf24',
    color: '#92400e',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    marginBottom: '1rem',
    textAlign: 'center',
    fontWeight: '500'
  },
  highRisk: {
    color: '#dc2626',
    fontWeight: 'bold'
  },
  toggleButton: {
    width: '100%',
    padding: '0.75rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  detailsSection: {
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: '2px solid #e5e7eb'
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem'
  },
  detailCard: {
    background: 'white',
    padding: '1rem',
    borderRadius: '8px'
  },
  detailTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.75rem'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
  },
  actionButton: {
    width: '100%',
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  }
};

export default DepartmentList;
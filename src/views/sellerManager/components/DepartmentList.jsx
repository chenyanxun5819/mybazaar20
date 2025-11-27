import { useState } from 'react';

/**
 * Department List Component
 * 
 * @description
 * 显示 Seller Manager 管理的部门列表
 * 数据来源：Event/{eventId}/departmentStats/{departmentCode}
 */
const DepartmentList = ({ departmentStats, onSelectDepartment }) => {
  const [sortBy, setSortBy] = useState('revenue'); // revenue | collectionRate | name
  const [showDetails, setShowDetails] = useState(null); // 展开的部门 ID

  /**
   * 排序部门
   */
  const getSortedDepartments = () => {
    if (!departmentStats || departmentStats.length === 0) return [];

    return [...departmentStats].sort((a, b) => {
      const aStats = a.pointsStats || {};
      const bStats = b.pointsStats || {};

      switch (sortBy) {
        case 'revenue':
          return (bStats.totalRevenue || 0) - (aStats.totalRevenue || 0);
        case 'collectionRate':
          return (bStats.collectionRate || 0) - (aStats.collectionRate || 0);
        case 'name':
          return (a.departmentCode || '').localeCompare(b.departmentCode || '');
        default:
          return 0;
      }
    });
  };

  const sortedDepartments = getSortedDepartments();

  if (!departmentStats || departmentStats.length === 0) {
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
      {/* 标题和排序 */}
      <div style={styles.header}>
        <h2 style={styles.title}>🏫 管理的部门 ({departmentStats.length})</h2>
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

      {/* 部门卡片列表 */}
      <div style={styles.grid}>
        {sortedDepartments.map((dept, index) => (
          <DepartmentCard
            key={dept.id}
            dept={dept}
            rank={index + 1}
            isExpanded={showDetails === dept.id}
            onToggle={() => setShowDetails(showDetails === dept.id ? null : dept.id)}
            onSelect={onSelectDepartment}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * 单个部门卡片
 */
const DepartmentCard = ({ dept, rank, isExpanded, onToggle, onSelect }) => {
  const pointsStats = dept.pointsStats || {};
  const membersStats = dept.membersStats || {};
  const allocationStats = dept.allocationStats || {};
  const collectionAlerts = dept.collectionAlerts || {};

  // 收款率颜色
  const collectionRate = pointsStats.collectionRate || 0;
  const getRateColor = (rate) => {
    if (rate >= 0.8) return '#10b981';
    if (rate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  // 排名徽章颜色
  const getRankColor = (rank) => {
    if (rank === 1) return '#fbbf24'; // 金色
    if (rank === 2) return '#9ca3af'; // 银色
    if (rank === 3) return '#cd7f32'; // 铜色
    return '#6b7280';
  };

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
      {/* 排名徽章 */}
      <div
        style={{
          ...styles.rankBadge,
          background: getRankColor(rank)
        }}
      >
        #{rank}
      </div>

      {/* 部门头部 */}
      <div style={styles.cardHeader}>
        <div style={styles.deptIcon}>
          {dept.departmentCode?.[0] || '?'}
        </div>
        <div style={styles.deptInfo}>
          <h3 style={styles.deptCode}>{dept.departmentCode}</h3>
          <p style={styles.deptName}>
            {dept.departmentName || '未命名部门'}
          </p>
          <div style={styles.memberCount}>
            👥 {membersStats.totalCount || 0} 人 
            <span style={styles.activeCount}>
              (活跃: {membersStats.activeCount || 0})
            </span>
          </div>
        </div>
      </div>

      {/* 主要统计 */}
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

      {/* 收款率进度条 */}
      <div style={styles.collectionSection}>
        <div style={styles.collectionHeader}>
          <span style={styles.collectionLabel}>收款率</span>
          <span
            style={{
              ...styles.collectionPercent,
              color: getRateColor(collectionRate)
            }}
          >
            {Math.round(collectionRate * 100)}%
          </span>
        </div>
        <div style={styles.progressBar}>
          <div
            style={{
              ...styles.progressFill,
              width: `${collectionRate * 100}%`,
              background: getRateColor(collectionRate)
            }}
          ></div>
        </div>
        <div style={styles.collectionDetails}>
          <span>已收款: RM {(pointsStats.totalCollected || 0).toLocaleString()}</span>
          <span style={{ color: '#ef4444' }}>
            待收款: RM {(pointsStats.pendingCollection || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* 警示提示 */}
      {collectionAlerts.usersWithWarnings > 0 && (
        <div style={styles.alertBanner}>
          ⚠️ {collectionAlerts.usersWithWarnings} 位用户有收款警示
          {collectionAlerts.highRiskUsers?.length > 0 && (
            <span style={styles.highRisk}>
              ({collectionAlerts.highRiskUsers.length} 高风险)
            </span>
          )}
        </div>
      )}

      {/* 展开/折叠详情 */}
      <button
        style={styles.toggleButton}
        onClick={onToggle}
      >
        {isExpanded ? '▲ 收起详情' : '▼ 查看详情'}
      </button>

      {/* 详细信息（展开时显示）*/}
      {isExpanded && (
        <div style={styles.detailsSection}>
          <div style={styles.detailsGrid}>
            {/* 点数流动 */}
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

            {/* 分配统计 */}
            <div style={styles.detailCard}>
              <div style={styles.detailTitle}>📦 分配统计</div>
              <div style={styles.detailRow}>
                <span>总分配次数:</span>
                <strong>{allocationStats.totalAllocations || 0}</strong>
              </div>
              <div style={styles.detailRow}>
                <span>来自 Event Mgr:</span>
                <strong>{allocationStats.byEventManager?.count || 0} 次</strong>
              </div>
              <div style={styles.detailRow}>
                <span>来自 Seller Mgr:</span>
                <strong>{allocationStats.bySellerManager?.count || 0} 次</strong>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <button
            style={styles.actionButton}
            onClick={() => onSelect(dept)}
          >
            👁️ 查看该部门的 Sellers
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    width: '100%'
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
    transition: 'all 0.2s',
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
  deptInfo: {
    flex: 1
  },
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
  collectionSection: {
    marginBottom: '1rem'
  },
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
    transition: 'width 0.3s ease',
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
    color: '#374151',
    transition: 'all 0.2s'
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
    fontWeight: '600',
    transition: 'all 0.2s'
  }
};

export default DepartmentList;
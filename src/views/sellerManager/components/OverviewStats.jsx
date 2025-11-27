/**
 * Overview Stats Component
 * 
 * @description
 * 显示 Seller Manager 的概览统计信息
 * 数据来源：Event/{eventId}/sellerManagerStats/{sellerManagerId}
 */
const OverviewStats = ({ smStats, departmentStats, eventData }) => {
  if (!smStats) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>📊</div>
        <p>统计数据加载中...</p>
      </div>
    );
  }

  const managedStats = smStats.managedUsersStats || {};
  const allocationStats = smStats.allocationStats || {};
  const collectionMgmt = smStats.collectionManagement || {};

  // 计算收款率颜色
  const getCollectionRateColor = (rate) => {
    if (rate >= 0.8) return '#10b981'; // 绿色
    if (rate >= 0.5) return '#f59e0b'; // 黄色
    return '#ef4444'; // 红色
  };

  return (
    <div style={styles.container}>
      {/* 标题 */}
      <h2 style={styles.sectionTitle}>📊 管理概览</h2>

      {/* 个人分配统计 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>我的分配统计</h3>
        <div style={styles.statsGrid}>
          <StatCard
            icon="📦"
            title="累计分配次数"
            value={allocationStats.totalAllocations || 0}
            color="#3b82f6"
          />
          <StatCard
            icon="💰"
            title="累计分配点数"
            value={`RM ${(allocationStats.totalPointsAllocated || 0).toLocaleString()}`}
            color="#8b5cf6"
          />
          <StatCard
            icon="📊"
            title="平均每次分配"
            value={`RM ${Math.round(allocationStats.averagePerAllocation || 0)}`}
            color="#06b6d4"
          />
          <StatCard
            icon="🎯"
            title="分配上限"
            value={`RM ${eventData?.pointAllocationRules?.sellerManager?.maxPerAllocation || 100}/次`}
            color="#84cc16"
            description="每次每人最高"
          />
        </div>
      </div>

      {/* 管理用户统计 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>管理的 Sellers 统计</h3>
        <div style={styles.statsGrid}>
          <StatCard
            icon="👥"
            title="总用户数"
            value={managedStats.totalUsers || 0}
            subtitle={`活跃: ${managedStats.activeUsers || 0}`}
            color="#f59e0b"
          />
          <StatCard
            icon="💳"
            title="当前持有点数"
            value={`RM ${(managedStats.currentBalance || 0).toLocaleString()}`}
            color="#10b981"
          />
          <StatCard
            icon="📈"
            title="累计销售额"
            value={`RM ${(managedStats.totalRevenue || 0).toLocaleString()}`}
            color="#6366f1"
          />
          <StatCard
            icon="✅"
            title="已收款"
            value={`RM ${(managedStats.totalCollected || 0).toLocaleString()}`}
            color="#14b8a6"
          />
        </div>
      </div>

      {/* 收款监控 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>💰 收款监控</h3>
        <div style={styles.collectionCard}>
          <div style={styles.collectionRow}>
            <div style={styles.collectionLabel}>收款率</div>
            <div style={styles.collectionValue}>
              <span style={{
                fontSize: '2rem',
                fontWeight: 'bold',
                color: getCollectionRateColor(managedStats.collectionRate || 0)
              }}>
                {Math.round((managedStats.collectionRate || 0) * 100)}%
              </span>
            </div>
          </div>
          
          {/* 收款进度条 */}
          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${(managedStats.collectionRate || 0) * 100}%`,
                background: getCollectionRateColor(managedStats.collectionRate || 0)
              }}
            ></div>
          </div>

          <div style={styles.collectionDetails}>
            <div style={styles.detailRow}>
              <span>待收款金额:</span>
              <span style={styles.detailValue}>
                RM {(managedStats.pendingCollection || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span>有警示的用户:</span>
              <span style={{
                ...styles.detailValue,
                color: collectionMgmt.usersWithWarnings > 0 ? '#ef4444' : '#10b981'
              }}>
                {collectionMgmt.usersWithWarnings || 0} 人
              </span>
            </div>
            <div style={styles.detailRow}>
              <span>高风险用户:</span>
              <span style={{
                ...styles.detailValue,
                color: collectionMgmt.highRiskUsers > 0 ? '#dc2626' : '#10b981'
              }}>
                {collectionMgmt.highRiskUsers || 0} 人
              </span>
            </div>
          </div>

          {collectionMgmt.usersWithWarnings > 0 && (
            <div style={styles.warningBox}>
              ⚠️ 有 {collectionMgmt.usersWithWarnings} 位用户需要关注收款情况
            </div>
          )}
        </div>
      </div>

      {/* 部门概览 */}
      {departmentStats && departmentStats.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.subsectionTitle}>🏫 管理的部门 ({departmentStats.length})</h3>
          <div style={styles.departmentGrid}>
            {departmentStats.map(dept => (
              <DepartmentMiniCard key={dept.id} dept={dept} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// === 统计卡片组件 ===
const StatCard = ({ icon, title, value, subtitle, color, description }) => (
  <div style={{ ...styles.statCard, borderLeftColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
      {subtitle && (
        <div style={styles.statSubtitle}>{subtitle}</div>
      )}
      {description && (
        <div style={styles.statDescription}>{description}</div>
      )}
    </div>
  </div>
);

// === 部门迷你卡片 ===
const DepartmentMiniCard = ({ dept }) => {
  const pointsStats = dept.pointsStats || {};
  const collectionRate = pointsStats.collectionRate || 0;

  return (
    <div style={styles.deptMiniCard}>
      <div style={styles.deptHeader}>
        <div style={styles.deptCode}>{dept.departmentCode}</div>
        <div style={styles.deptName}>{dept.departmentName || '未命名部门'}</div>
      </div>
      <div style={styles.deptStats}>
        <div style={styles.deptStatRow}>
          <span>成员:</span>
          <strong>{dept.membersStats?.totalCount || 0}</strong>
        </div>
        <div style={styles.deptStatRow}>
          <span>销售额:</span>
          <strong>RM {(pointsStats.totalRevenue || 0).toLocaleString()}</strong>
        </div>
        <div style={styles.deptStatRow}>
          <span>收款率:</span>
          <strong style={{
            color: collectionRate >= 0.8 ? '#10b981' : 
                   collectionRate >= 0.5 ? '#f59e0b' : '#ef4444'
          }}>
            {Math.round(collectionRate * 100)}%
          </strong>
        </div>
      </div>
    </div>
  );
};

// === 样式 ===
const styles = {
  container: {
    padding: '0'
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '1.5rem'
  },
  section: {
    marginBottom: '2rem'
  },
  subsectionTitle: {
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
    alignItems: 'flex-start',
    gap: '1rem',
    transition: 'transform 0.2s',
    cursor: 'default'
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
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  statSubtitle: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  statDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  collectionCard: {
    background: '#fafafa',
    padding: '1.5rem',
    borderRadius: '12px',
    border: '2px solid #e5e7eb'
  },
  collectionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  collectionLabel: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#374151'
  },
  collectionValue: {
    textAlign: 'right'
  },
  progressBar: {
    height: '12px',
    background: '#e5e7eb',
    borderRadius: '6px',
    overflow: 'hidden',
    marginBottom: '1.5rem'
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: '6px'
  },
  collectionDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    marginBottom: '1rem'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  detailValue: {
    fontWeight: '600',
    color: '#1f2937'
  },
  warningBox: {
    background: '#fef3c7',
    border: '2px solid #fbbf24',
    color: '#92400e',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    textAlign: 'center'
  },
  departmentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: '1rem'
  },
  deptMiniCard: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1rem',
    transition: 'all 0.2s',
    cursor: 'pointer'
  },
  deptHeader: {
    marginBottom: '0.75rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid #e5e7eb'
  },
  deptCode: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#f59e0b',
    marginBottom: '0.25rem'
  },
  deptName: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  deptStats: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  deptStatRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  }
};

export default OverviewStats;
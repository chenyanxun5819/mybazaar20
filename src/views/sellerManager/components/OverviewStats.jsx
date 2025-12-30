/**
 * Overview Stats Component (超级安全版 v3)
 */
const OverviewStats = ({ smStats, departmentStats, eventData }) => {
  // 确保所有输入都是安全的
  const safeSmStats = (smStats && typeof smStats === 'object') ? smStats : null;
  const safeDepartmentStats = Array.isArray(departmentStats) ? departmentStats : [];
  const safeEventData = (eventData && typeof eventData === 'object') ? eventData : {};

  if (!safeSmStats) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>📊</div>
        <p>统计数据加载中...</p>
      </div>
    );
  }

  // 安全读取
  const managedStats = (safeSmStats.managedUsersStats && typeof safeSmStats.managedUsersStats === 'object') 
    ? safeSmStats.managedUsersStats 
    : {};
  const allocationStats = (safeSmStats.allocationStats && typeof safeSmStats.allocationStats === 'object')
    ? safeSmStats.allocationStats
    : {};
  const collectionMgmt = (safeSmStats.collectionManagement && typeof safeSmStats.collectionManagement === 'object')
    ? safeSmStats.collectionManagement
    : {};

  // 读取分配规则
  const getAllocationRules = () => {
    const defaults = { maxPerAllocation: 100, warningThreshold: 0.3 };
    
    try {
      if (!safeEventData.pointAllocationRules || 
          typeof safeEventData.pointAllocationRules !== 'object') {
        return defaults;
      }
      
      if (!safeEventData.pointAllocationRules.sellerManager ||
          typeof safeEventData.pointAllocationRules.sellerManager !== 'object') {
        return defaults;
      }
      
      const rules = safeEventData.pointAllocationRules.sellerManager;
      return {
        maxPerAllocation: typeof rules.maxPerAllocation === 'number' ? rules.maxPerAllocation : 100,
        warningThreshold: typeof rules.warningThreshold === 'number' ? rules.warningThreshold : 0.3
      };
    } catch (e) {
      return defaults;
    }
  };

  const allocationRules = getAllocationRules();

  const getCollectionRateColor = (rate) => {
    const safeRate = typeof rate === 'number' ? rate : 0;
    if (safeRate >= 0.8) return '#10b981';
    if (safeRate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.sectionTitle}>📊 管理概览</h2>

      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>我的分配统计</h3>
        <div style={styles.statsGrid}>
          <StatCard
            icon="📦"
            title="累计分配次数"
            value={String(allocationStats.totalAllocations || 0)}
            color="#3b82f6"
          />
          <StatCard
            icon="💰"
            title="累计分配点数"
            value={`${(allocationStats.totalPointsAllocated || 0).toLocaleString()}`}
            color="#8b5cf6"
          />
          <StatCard
            icon="📊"
            title="平均每次分配"
            value={`${Math.round(allocationStats.averagePerAllocation || 0)}`}
            color="#06b6d4"
          />
          <StatCard
            icon="🎯"
            title="分配上限"
            value={`${allocationRules.maxPerAllocation.toLocaleString()}/次`}
            color="#84cc16"
            description="每次每人最高"
          />
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>管理的 Sellers 统计</h3>
        <div style={styles.statsGrid}>
          <StatCard
            icon="👥"
            title="总用户数"
            value={String(managedStats.totalUsers || 0)}
            subtitle={`活跃: ${managedStats.activeUsers || 0}`}
            color="#f59e0b"
          />
          <StatCard
            icon="💳"
            title="当前持有点数"
            value={`${(managedStats.currentBalance || 0).toLocaleString()}`}
            color="#10b981"
          />
          <StatCard
            icon="📈"
            title="累计销售额"
            value={`${(managedStats.totalRevenue || 0).toLocaleString()}`}
            color="#6366f1"
          />
          <StatCard
            icon="✅"
            title="已收款"
            value={`${(managedStats.totalCollected || 0).toLocaleString()}`}
            color="#14b8a6"
          />
        </div>
      </div>

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
          
          <div style={styles.progressBar}>
            <div style={{
              ...styles.progressFill,
              width: `${Math.min(100, (managedStats.collectionRate || 0) * 100)}%`,
              background: getCollectionRateColor(managedStats.collectionRate || 0)
            }}></div>
          </div>

          <div style={styles.collectionDetails}>
            <div style={styles.detailRow}>
              <span>待收款金额:</span>
              <span style={styles.detailValue}>
                {(managedStats.pendingCollection || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span>有警示的用户:</span>
              <span style={{
                ...styles.detailValue,
                color: (collectionMgmt.usersWithWarnings || 0) > 0 ? '#ef4444' : '#10b981'
              }}>
                {collectionMgmt.usersWithWarnings || 0} 人
              </span>
            </div>
            <div style={styles.detailRow}>
              <span>高风险用户:</span>
              <span style={{
                ...styles.detailValue,
                color: (collectionMgmt.highRiskUsers || 0) > 0 ? '#dc2626' : '#10b981'
              }}>
                {collectionMgmt.highRiskUsers || 0} 人
              </span>
            </div>
            <div style={styles.detailRow}>
              <span>警示阈值:</span>
              <span style={styles.detailValue}>
                {Math.round(allocationRules.warningThreshold * 100)}%
              </span>
            </div>
          </div>

          {(collectionMgmt.usersWithWarnings || 0) > 0 && (
            <div style={styles.warningBox}>
              ⚠️ 有 {collectionMgmt.usersWithWarnings} 位用户需要关注收款情况
            </div>
          )}
        </div>
      </div>

      {safeDepartmentStats.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.subsectionTitle}>🏫 管理的部门 ({safeDepartmentStats.length})</h3>
          <div style={styles.departmentGrid}>
            {safeDepartmentStats.map((dept, index) => (
              <DepartmentMiniCard key={dept.id || dept.departmentCode || `dept-${index}`} dept={dept} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ icon, title, value, subtitle, color, description }) => {
  const safeIcon = String(icon || '📊');
  const safeTitle = String(title || '');
  const safeValue = String(value || '0');
  const safeColor = String(color || '#000000');
  
  return (
    <div style={{ ...styles.statCard, borderLeftColor: safeColor }}>
      <div style={styles.statIcon}>{safeIcon}</div>
      <div style={styles.statContent}>
        <div style={styles.statValue}>{safeValue}</div>
        <div style={styles.statTitle}>{safeTitle}</div>
        {subtitle && <div style={styles.statSubtitle}>{String(subtitle)}</div>}
        {description && <div style={styles.statDescription}>{String(description)}</div>}
      </div>
    </div>
  );
};

const DepartmentMiniCard = ({ dept }) => {
  if (!dept || typeof dept !== 'object') return null;

  const pointsStats = (dept.pointsStats && typeof dept.pointsStats === 'object') ? dept.pointsStats : {};
  const membersStats = (dept.membersStats && typeof dept.membersStats === 'object') ? dept.membersStats : {};
  const collectionRate = typeof pointsStats.collectionRate === 'number' ? pointsStats.collectionRate : 0;

  const getRateColor = (rate) => {
    if (rate >= 0.8) return '#10b981';
    if (rate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div style={styles.deptMiniCard}>
      <div style={styles.deptHeader}>
        <div style={styles.deptCode}>{dept.departmentCode || '未知'}</div>
        <div style={styles.deptName}>{dept.departmentName || '未命名部门'}</div>
      </div>
      <div style={styles.deptStats}>
        <div style={styles.deptStatRow}>
          <span>成员:</span>
          <strong>{membersStats.totalCount || 0}</strong>
        </div>
        <div style={styles.deptStatRow}>
          <span>销售额:</span>
          <strong>{(pointsStats.totalRevenue || 0).toLocaleString()}</strong>
        </div>
        <div style={styles.deptStatRow}>
          <span>收款率:</span>
          <strong style={{ color: getRateColor(collectionRate) }}>
            {Math.round(collectionRate * 100)}%
          </strong>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: { padding: '0' },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '1.5rem'
  },
  section: { marginBottom: '2rem' },
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
    gap: '1rem'
  },
  statIcon: { fontSize: '2rem' },
  statContent: { flex: 1 },
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
  collectionValue: { textAlign: 'right' },
  progressBar: {
    height: '12px',
    background: '#e5e7eb',
    borderRadius: '6px',
    overflow: 'hidden',
    marginBottom: '1.5rem'
  },
  progressFill: {
    height: '100%',
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
    padding: '1rem'
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

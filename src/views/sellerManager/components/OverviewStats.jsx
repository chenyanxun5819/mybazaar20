/**
 * OverviewStats Component (方案A 更新版)
 * 
 * ✅ 方案A 更新：
 * - 显示现金来源明细（售点收入 vs 购点收入）
 * - 从 sellerManager.cashStats.cashSources 读取数据
 * 
 * @version 3.1
 * @date 2026-01-11
 */
import { useSellerManagerStats, useManagedUsers } from '../../../hooks/sellerManager';

const OverviewStats = ({
  organizationId,
  eventId,
  sellerManagerId,
  managedDepartments,
  eventData
}) => {
  // 使用Hooks获取实时数据
  const { smStats, loading, error } = useSellerManagerStats(
    organizationId,
    eventId,
    sellerManagerId
  );

  const { users, loading: usersLoading, stats: usersStats } = useManagedUsers(
    organizationId,
    eventId,
    sellerManagerId
  );

  console.log('🔍 [OverviewStats] 收到的参数:', {
    organizationId,
    eventId,
    sellerManagerId,
    managedDepartments,
    hasSmStats: !!smStats,
    loading,
    error,
    usersCount: users?.length || 0,
    usersLoading,
    totalPoints: users?.reduce((sum, u) => sum + (u.seller?.availablePoints || 0), 0) || 0
  });

  // 处理加载状态
  if (loading || usersLoading) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>⏳</div>
        <p>统计数据加载中...</p>
      </div>
    );
  }

  // 从users实时计算
  const managedStats = {
    totalUsers: users.length,
    activeUsers: users.filter(u => u.status === 'active').length,
    currentBalance: users.reduce((sum, u) => sum + (u.seller?.availablePoints || 0), 0),
    totalRevenue: users.reduce((sum, u) => sum + (u.seller?.totalRevenue || 0), 0),
    totalCollected: users.reduce((sum, u) => sum + (u.seller?.totalCashCollected || 0), 0),
    pendingCollection: users.reduce((sum, u) => sum + (u.seller?.pendingCollection || 0), 0),
    collectionRate: (() => {
      const totalRev = users.reduce((sum, u) => sum + (u.seller?.totalRevenue || 0), 0);
      const totalCol = users.reduce((sum, u) => sum + (u.seller?.totalCashCollected || 0), 0);
      return totalRev > 0 ? totalCol / totalRev : 0;
    })()
  };

  // allocationStats 从 smStats 读取
  const allocationStats = (smStats && smStats.allocationStats) ? smStats.allocationStats : {
    totalAllocations: 0,
    totalPointsAllocated: 0,
    averagePerAllocation: 0,
    lastAllocationAt: null
  };

  // collectionMgmt 从users实时计算
  const collectionMgmt = {
    usersWithWarnings: users.filter(u => u.seller?.collectionAlert?.hasWarning).length,
    highRiskUsers: users.filter(u => {
      const revenue = u.seller?.totalRevenue || 0;
      const collected = u.seller?.totalCashCollected || 0;
      return revenue > 0 && (collected / revenue) < 0.3;
    }).length,
    totalCashHolding: users.reduce((sum, u) => sum + (u.seller?.pendingCollection || 0), 0)
  };

  // ✅ 方案A：读取现金来源（从 smStats 或 实时计算）
  const cashSources = smStats?.cashSources || {
    fromPointSales: smStats?.cashStats?.cashSources?.fromPointSales || 0,
    fromPointPurchase: smStats?.cashStats?.cashSources?.fromPointPurchase || 0
  };

  // 计算总现金（向后兼容）
  const totalCashOnHand = smStats?.cashStats?.cashOnHand || 
                          (cashSources.fromPointSales + cashSources.fromPointPurchase);

  console.log('💰 [OverviewStats] 现金来源统计', {
    totalCashOnHand,
    fromPointSales: cashSources.fromPointSales,
    fromPointPurchase: cashSources.fromPointPurchase
  });

  // 读取分配规则
  const getAllocationRules = () => {
    const defaults = { maxPerAllocation: 100, warningThreshold: 0.3 };

    try {
      if (!eventData || typeof eventData !== 'object') {
        return defaults;
      }

      if (!eventData.pointAllocationRules ||
        typeof eventData.pointAllocationRules !== 'object') {
        return defaults;
      }

      if (!eventData.pointAllocationRules.sellerManager ||
        typeof eventData.pointAllocationRules.sellerManager !== 'object') {
        return defaults;
      }

      const rules = eventData.pointAllocationRules.sellerManager;
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

      {/* 我的分配统计 */}
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

      {/* 管理的 Sellers 统计 */}
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

      {/* 💰 收款监控 */}
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
                RM {(managedStats.pendingCollection || 0).toLocaleString()}
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

      {/* ✅ 方案A：新增现金持有明细 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>💵 现金持有明细</h3>
        <div style={styles.cashCard}>
          <div style={styles.cashTotalRow}>
            <div style={styles.cashTotalLabel}>手上现金总额</div>
            <div style={styles.cashTotalValue}>
              RM {totalCashOnHand.toLocaleString()}
            </div>
          </div>

          <div style={styles.cashBreakdown}>
            <div style={styles.cashSourceRow}>
              <div style={styles.cashSourceIcon}>🛒</div>
              <div style={styles.cashSourceInfo}>
                <div style={styles.cashSourceLabel}>来自售点收入</div>
                <div style={styles.cashSourceDesc}>Seller 售点后上交的现金</div>
              </div>
              <div style={styles.cashSourceAmount}>
                RM {(cashSources.fromPointSales || 0).toLocaleString()}
              </div>
            </div>

            <div style={styles.cashSourceRow}>
              <div style={styles.cashSourceIcon}>💰</div>
              <div style={styles.cashSourceInfo}>
                <div style={styles.cashSourceLabel}>来自购点收入</div>
                <div style={styles.cashSourceDesc}>Seller 购买点数的现金</div>
              </div>
              <div style={styles.cashSourceAmount}>
                RM {(cashSources.fromPointPurchase || 0).toLocaleString()}
              </div>
            </div>
          </div>

          <div style={styles.cashNote}>
            💡 上交现金给 Cashier 时，会扣除相应金额
          </div>
        </div>
      </div>
    </div>
  );
};

// StatCard 组件保持不变
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
  // ✅ 方案A：新增现金卡片样式
  cashCard: {
    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    padding: '1.5rem',
    borderRadius: '12px',
    border: '2px solid #fbbf24'
  },
  cashTotalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
    paddingBottom: '1rem',
    borderBottom: '2px solid #fbbf24'
  },
  cashTotalLabel: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#92400e'
  },
  cashTotalValue: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#92400e'
  },
  cashBreakdown: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginBottom: '1rem'
  },
  cashSourceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    background: '#fffbeb',
    padding: '1rem',
    borderRadius: '8px',
    border: '1px solid #fde68a'
  },
  cashSourceIcon: {
    fontSize: '2rem',
    flexShrink: 0
  },
  cashSourceInfo: {
    flex: 1
  },
  cashSourceLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#92400e',
    marginBottom: '0.25rem'
  },
  cashSourceDesc: {
    fontSize: '0.75rem',
    color: '#b45309'
  },
  cashSourceAmount: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#92400e',
    flexShrink: 0
  },
  cashNote: {
    fontSize: '0.75rem',
    color: '#b45309',
    textAlign: 'center',
    fontStyle: 'italic'
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

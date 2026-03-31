import { useSellerManagerStats, useManagedUsers } from '../../../../hooks/sellerManager';

const OverviewStatsPhone = ({
  organizationId,
  eventId,
  sellerManagerId,
  managedDepartments,
  eventData
}) => {
  const { smStats, loading, error } = useSellerManagerStats(
    organizationId,
    eventId,
    sellerManagerId
  );

  const { users, loading: usersLoading } = useManagedUsers(
    organizationId,
    eventId,
    sellerManagerId
  );

  if (loading || usersLoading) {
    return (
      <div style={styles.centered}>
        <p style={{ color: '#6b7280' }}>统计加载中...</p>
      </div>
    );
  }

  // 从实时用户数据计算
  const managedStats = {
    totalUsers: users.length,
    activeUsers: users.filter(u => u.status === 'active').length,
    currentBalance: users.reduce((s, u) => s + (u.seller?.availablePoints || 0), 0),
    totalRevenue: users.reduce((s, u) => s + (u.seller?.totalRevenue || 0), 0),
    totalCollected: users.reduce((s, u) => s + (u.seller?.totalCashCollected || 0), 0),
    pendingCollection: users.reduce((s, u) => s + (u.seller?.pendingCollection || 0), 0),
    usersWithWarnings: users.filter(u => u.seller?.collectionAlert?.hasWarning).length
  };

  const collectionRate =
    managedStats.totalRevenue > 0
      ? managedStats.totalCollected / managedStats.totalRevenue
      : 0;

  const allocationStats = smStats?.allocationStats || {
    totalAllocations: 0,
    totalPointsAllocated: 0,
    averagePerAllocation: 0
  };

  const cashSources = smStats?.cashSources || {};
  const totalCashOnHand =
    smStats?.cashStats?.cashOnHand ||
    (cashSources.fromPointSales || 0) + (cashSources.fromPointPurchase || 0);

  const rateColor =
    collectionRate >= 0.8 ? '#10b981' : collectionRate >= 0.5 ? '#f59e0b' : '#ef4444';

  const maxPerAllocation =
    eventData?.pointAllocationRules?.sellerManager?.maxPerAllocation ?? 100;

  return (
    <div style={styles.container}>
      {/* 学生统计 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>学生统计</h2>
        <div style={styles.summaryCardAmber}>
          <div style={styles.summaryStats}>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{managedStats.totalUsers} 人</span>
              <span style={styles.summaryStatLabel}>总人数</span>
            </div>
            <div style={styles.summaryStatDivider} />
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{managedStats.currentBalance.toLocaleString()}</span>
              <span style={styles.summaryStatLabel}>持有点数</span>
            </div>
            <div style={styles.summaryStatDivider} />
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{managedStats.totalRevenue.toLocaleString()}</span>
              <span style={styles.summaryStatLabel}>累计销售额</span>
            </div>
            <div style={styles.summaryStatDivider} />
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{managedStats.totalCollected.toLocaleString()}</span>
              <span style={styles.summaryStatLabel}>已收款</span>
            </div>
          </div>
        </div>
      </section>

      {/* 分配统计 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>我的分配统计</h2>
        <div style={styles.summaryCardBlue}>
          <div style={styles.summaryStats}>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{allocationStats.totalAllocations}</span>
              <span style={styles.summaryStatLabel}>分配次数</span>
            </div>
            <div style={styles.summaryStatDivider} />
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{allocationStats.totalPointsAllocated.toLocaleString()}</span>
              <span style={styles.summaryStatLabel}>累计分配点</span>
            </div>
            <div style={styles.summaryStatDivider} />
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{Math.round(allocationStats.averagePerAllocation)}</span>
              <span style={styles.summaryStatLabel}>平均每次</span>
            </div>
            <div style={styles.summaryStatDivider} />
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{maxPerAllocation}/次</span>
              <span style={styles.summaryStatLabel}>单次上限</span>
            </div>
          </div>
        </div>
      </section>

      {/* 收款率 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>收款监控</h2>
        <div style={styles.collectionCard}>
          <div style={styles.rateRow}>
            <span style={styles.rateLabel}>收款率</span>
            <span style={{ ...styles.rateValue, color: rateColor }}>
              {Math.round(collectionRate * 100)}%
            </span>
          </div>
          <div style={styles.progressBar}>
            <div style={{
              ...styles.progressFill,
              width: `${Math.min(100, collectionRate * 100)}%`,
              background: rateColor
            }} />
          </div>
          <div style={styles.detailRows}>
            <DetailRow label="待收款" value={`RM ${managedStats.pendingCollection.toLocaleString()}`} />
            <DetailRow
              label="有警示用户"
              value={`${managedStats.usersWithWarnings} 人`}
              valueColor={managedStats.usersWithWarnings > 0 ? '#ef4444' : '#10b981'}
            />
          </div>
          {managedStats.usersWithWarnings > 0 && (
            <div style={styles.warningBox}>
              ⚠️ {managedStats.usersWithWarnings} 位用户需关注收款
            </div>
          )}
        </div>
      </section>

      {/* 现金持有 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>现金持有</h2>
        <div style={styles.cashCard}>
          <div style={styles.cashTotal}>
            <span style={styles.cashTotalLabel}>手上现金总额</span>
            <span style={styles.cashTotalValue}>RM {totalCashOnHand.toLocaleString()}</span>
          </div>
          <div style={styles.cashBreakdown}>
            <CashSourceRow
              icon="🛒"
              label="售点收入"
              amount={cashSources.fromPointSales || 0}
            />
            <CashSourceRow
              icon="💰"
              label="购点收入"
              amount={cashSources.fromPointPurchase || 0}
            />
          </div>
        </div>
      </section>
    </div>
  );
};

const DetailRow = ({ label, value, valueColor }) => (
  <div style={styles.detailRow}>
    <span style={styles.detailLabel}>{label}</span>
    <span style={{ ...styles.detailValue, ...(valueColor ? { color: valueColor } : {}) }}>
      {value}
    </span>
  </div>
);

const CashSourceRow = ({ icon, label, amount }) => (
  <div style={styles.cashSourceRow}>
    <span style={styles.cashSourceIcon}>{icon}</span>
    <span style={styles.cashSourceLabel}>{label}</span>
    <span style={styles.cashSourceAmount}>RM {(amount || 0).toLocaleString()}</span>
  </div>
);

const styles = {
  container: { paddingBottom: '1rem' },
  centered: { textAlign: 'center', padding: '3rem' },
  section: { marginBottom: '1.25rem' },
  sectionTitle: {
    fontSize: '0.9375rem',
    fontWeight: '700',
    color: '#374151',
    marginBottom: '0.75rem',
    marginTop: 0
  },
  summaryCardAmber: {
    padding: '1.25rem 0.65rem',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
    color: '#fff',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
  },
  summaryCardBlue: {
    padding: '1.25rem 0.65rem',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)',
    color: '#fff',
    background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)'
  },
  summaryStats: { display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'nowrap' },
  summaryStatItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 1 0', textAlign: 'center' },
  summaryStatValue: { fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem' },
  summaryStatLabel: { fontSize: '0.75rem', opacity: 0.85 },
  summaryStatDivider: { width: '1px', backgroundColor: 'rgba(255,255,255,0.25)', alignSelf: 'stretch', margin: '0 0.25rem' },

  collectionCard: {
    background: 'white',
    borderRadius: '12px',
    padding: '1.25rem',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
  },
  rateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem'
  },
  rateLabel: { fontSize: '0.9375rem', fontWeight: '600', color: '#374151' },
  rateValue: { fontSize: '1.75rem', fontWeight: '800' },
  progressBar: {
    height: '10px',
    background: '#e5e7eb',
    borderRadius: '5px',
    overflow: 'hidden',
    marginBottom: '1rem'
  },
  progressFill: { height: '100%', borderRadius: '5px', transition: 'width 0.4s' },
  detailRows: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem'
  },
  detailLabel: { color: '#6b7280' },
  detailValue: { fontWeight: '600', color: '#1f2937' },
  warningBox: {
    marginTop: '0.75rem',
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    color: '#92400e',
    padding: '0.625rem',
    borderRadius: '8px',
    fontSize: '0.8125rem',
    fontWeight: '500',
    textAlign: 'center'
  },

  cashCard: {
    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    borderRadius: '12px',
    padding: '1.25rem',
    border: '1px solid #fbbf24'
  },
  cashTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid #fbbf24'
  },
  cashTotalLabel: { fontSize: '0.9375rem', fontWeight: '600', color: '#92400e' },
  cashTotalValue: { fontSize: '1.5rem', fontWeight: '800', color: '#92400e' },
  cashBreakdown: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  cashSourceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    background: '#fffbeb',
    padding: '0.625rem',
    borderRadius: '8px'
  },
  cashSourceIcon: { fontSize: '1.25rem' },
  cashSourceLabel: { flex: 1, fontSize: '0.875rem', color: '#92400e', fontWeight: '500' },
  cashSourceAmount: { fontSize: '1rem', fontWeight: '700', color: '#92400e' }
};

export default OverviewStatsPhone;

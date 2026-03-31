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
      {/* 分配统计 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>我的分配统计</h2>
        <div style={styles.grid2}>
          <StatCard icon="📦" label="分配次数" value={allocationStats.totalAllocations} color="#3b82f6" />
          <StatCard icon="💰" label="累计分配点" value={allocationStats.totalPointsAllocated.toLocaleString()} color="#8b5cf6" />
          <StatCard icon="📊" label="平均每次" value={Math.round(allocationStats.averagePerAllocation)} color="#06b6d4" />
          <StatCard icon="🎯" label="单次上限" value={`${maxPerAllocation}/次`} color="#84cc16" />
        </div>
      </section>

      {/* 卖家统计 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>卖家统计</h2>
        <div style={styles.grid2}>
          <StatCard icon="👥" label="总人数" value={`${managedStats.totalUsers} 人`} color="#f59e0b" />
          <StatCard icon="💳" label="持有点数" value={managedStats.currentBalance.toLocaleString()} color="#10b981" />
          <StatCard icon="📈" label="累计销售额" value={managedStats.totalRevenue.toLocaleString()} color="#6366f1" />
          <StatCard icon="✅" label="已收款" value={managedStats.totalCollected.toLocaleString()} color="#14b8a6" />
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

const StatCard = ({ icon, label, value, color }) => (
  <div style={{ ...styles.statCard, borderTopColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={{ ...styles.statValue, color: '#1f2937' }}>{String(value ?? 0)}</div>
    <div style={styles.statLabel}>{label}</div>
  </div>
);

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
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem'
  },
  statCard: {
    background: 'white',
    borderRadius: '12px',
    borderTop: '3px solid',
    padding: '1rem 0.75rem',
    textAlign: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
  },
  statIcon: { fontSize: '1.5rem', marginBottom: '0.375rem' },
  statValue: { fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.25rem' },
  statLabel: { fontSize: '0.75rem', color: '#6b7280', fontWeight: '500' },

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

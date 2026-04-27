import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../../config/firebase';

/**
 * OverviewStatsPhone - 手机版现金统计
 * 
 * 数据模型：
 * - customer.cashAccount.totalAllocatedCash - 应收现金总额
 * - customer.cashAccount.pendingCash - 待支付现金
 * - customer.cashAccount.confirmedCash - 已支付现金
 * - customer.cashAccount.emAllocatedCash - EM 分配
 * - customer.cashAccount.tlAllocatedCash - TL 派发
 */
const OverviewStatsPhone = ({
  organizationId,
  eventId,
  teamLeaderId,
  managedDepartments,
  eventData,
  userInfo
}) => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  const effectiveManagedDepartments = Array.isArray(managedDepartments) && managedDepartments.length > 0
    ? managedDepartments
    : (userInfo?.teamLeader?.managedDepartments || userInfo?.managedDepartments || []);

  // 加载 Customers 数据
  useEffect(() => {
    if (!organizationId || !eventId || !teamLeaderId) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    if (!Array.isArray(effectiveManagedDepartments) || effectiveManagedDepartments.length === 0) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const usersRef = collection(
      db,
      `organizations/${organizationId}/events/${eventId}/users`
    );

    const customerQuery = query(
      usersRef,
      where('roles', 'array-contains', 'customer')
    );

    const unsubscribe = onSnapshot(
      customerQuery,
      (snapshot) => {
        const nextCustomers = snapshot.docs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data()
          }))
          .filter((customer) => effectiveManagedDepartments.includes(customer.identityInfo?.department || ''));

        setCustomers(nextCustomers);
        setLoading(false);
      },
      (error) => {
        console.error('[OverviewStatsPhone] 加载 customers 失败:', error);
        setCustomers([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [organizationId, eventId, teamLeaderId, effectiveManagedDepartments]);

  // 计算现金相关统计
  const calculateCashStats = () => {
    if (!customers || customers.length === 0) {
      return {
        totalAllocatedCash: 0,
        pendingCash: 0,
        confirmedCash: 0,
        emAllocatedCash: 0,
        tlAllocatedCash: 0,
        studentsWithDebt: 0,
        studentsFullyPaid: 0,
        collectionRate: 0
      };
    }

    let stats = {
      totalAllocatedCash: 0,
      pendingCash: 0,
      confirmedCash: 0,
      emAllocatedCash: 0,
      tlAllocatedCash: 0,
      studentsWithDebt: 0,
      studentsFullyPaid: 0
    };

    customers.forEach((customer) => {
      const cashAccount = customer.customer?.cashAccount || {};
      const totalAllocated = cashAccount.totalAllocatedCash || 0;
      const pending = cashAccount.pendingCash || 0;
      const confirmed = cashAccount.confirmedCash || 0;

      stats.totalAllocatedCash += totalAllocated;
      stats.pendingCash += pending;
      stats.confirmedCash += confirmed;
      stats.emAllocatedCash += (cashAccount.emAllocatedCash || 0);
      stats.tlAllocatedCash += (cashAccount.tlAllocatedCash || 0);

      // 学生状态分类
      if (totalAllocated === 0) {
        // 无应收
      } else if (pending === 0) {
        stats.studentsFullyPaid += 1;
      } else {
        stats.studentsWithDebt += 1;
      }
    });

    // 计算收款率
    stats.collectionRate = stats.totalAllocatedCash > 0
      ? (stats.confirmedCash / stats.totalAllocatedCash) * 100
      : 0;

    return stats;
  };

  const cashStats = calculateCashStats();
  const teamLeaderCashStats = userInfo?.teamLeader?.cashStats || {};

  const getProgressColor = (rate) => {
    if (rate >= 80) return '#10b981';
    if (rate >= 50) return '#f59e0b';
    return '#ef4444';
  };

  if (loading) {
    return (
      <div style={styles.centered}>
        <p style={{ color: '#6b7280' }}>统计加载中...</p>
      </div>
    );
  }

  const rateColor = getProgressColor(cashStats.collectionRate);

  return (
    <div style={styles.container}>
      {/* 应收现金统计 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>💰 应收现金</h2>
        <div style={styles.statsGrid}>
          <StatCard
            icon="💵"
            label="应收总额"
            value={`RM ${(cashStats.totalAllocatedCash || 0).toLocaleString()}`}
            color="#ef4444"
          />
          <StatCard
            icon="⏳"
            label="待支付"
            value={`RM ${(cashStats.pendingCash || 0).toLocaleString()}`}
            color="#f59e0b"
          />
          <StatCard
            icon="✅"
            label="已支付"
            value={`RM ${(cashStats.confirmedCash || 0).toLocaleString()}`}
            color="#10b981"
          />
        </div>
      </section>

      {/* 收款率进度 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>📈 收款进度</h2>
        <div style={styles.rateCard}>
          <div style={styles.rateDisplay}>
            <span style={{ ...styles.rateValue, color: rateColor }}>
              {Math.round(cashStats.collectionRate || 0)}%
            </span>
          </div>
          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${Math.min(100, cashStats.collectionRate || 0)}%`,
                background: rateColor
              }}
            />
          </div>
          <div style={styles.rateDetails}>
            <div style={styles.rateDetail}>
              <span style={styles.rateDetailLabel}>学生待付:</span>
              <span style={styles.rateDetailValue}>{cashStats.studentsWithDebt} 人</span>
            </div>
            <div style={styles.rateDetail}>
              <span style={styles.rateDetailLabel}>已全部支付:</span>
              <span style={styles.rateDetailValue}>{cashStats.studentsFullyPaid} 人</span>
            </div>
          </div>
        </div>
      </section>

      {/* 现金来源 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>🔀 现金来源</h2>
        <div style={styles.sourceGrid}>
          <SourceCard
            icon="🏢"
            label="EM分配"
            value={`RM ${(cashStats.emAllocatedCash || 0).toLocaleString()}`}
            color="#3b82f6"
          />
          <SourceCard
            icon="👤"
            label="TL派发"
            value={`RM ${(cashStats.tlAllocatedCash || 0).toLocaleString()}`}
            color="#f59e0b"
          />
        </div>
      </section>

      {/* TL现金统计 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>👤 我的现金账户</h2>
        <div style={styles.tlStatsCard}>
          <TLStatRow
            label="已确认收入"
            value={`RM ${(teamLeaderCashStats.confirmedFromCustomers || 0).toLocaleString()}`}
            color="#10b981"
          />
          <TLStatRow
            label="待确认"
            value={`RM ${(teamLeaderCashStats.pendingFromCustomers || 0).toLocaleString()}`}
            color="#f59e0b"
          />
          <TLStatRow
            label="手上现金"
            value={`RM ${(teamLeaderCashStats.cashOnHand || 0).toLocaleString()}`}
            color="#3b82f6"
          />
        </div>
      </section>
    </div>
  );
};

const StatCard = ({ icon, label, value, color }) => (
  <div style={styles.statCard}>
    <div style={styles.statCardIcon}>{icon}</div>
    <div style={styles.statCardLabel}>{label}</div>
    <div style={{ ...styles.statCardValue, color }}>{value}</div>
  </div>
);

const SourceCard = ({ icon, label, value, color }) => (
  <div style={styles.sourceCard}>
    <div style={styles.sourceIcon}>{icon}</div>
    <div style={styles.sourceLabel}>{label}</div>
    <div style={{ ...styles.sourceValue, color }}>{value}</div>
  </div>
);

const TLStatRow = ({ label, value, color }) => (
  <div style={styles.tlStatRow}>
    <span style={styles.tlStatLabel}>{label}</span>
    <span style={{ ...styles.tlStatValue, color }}>{value}</span>
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
  centered: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  section: { marginBottom: '1.25rem' },
  sectionTitle: {
    fontSize: '0.9375rem',
    fontWeight: '700',
    color: '#374151',
    marginBottom: '0.75rem',
    marginTop: 0
  },

  // StatCard 样式
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.75rem'
  },
  statCard: {
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '0.75rem',
    textAlign: 'center',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  statCardIcon: {
    fontSize: '1.5rem',
    marginBottom: '0.25rem'
  },
  statCardLabel: {
    fontSize: '0.625rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  statCardValue: {
    fontSize: '0.875rem',
    fontWeight: '700'
  },

  // Rate Card 样式
  rateCard: {
    background: 'white',
    borderRadius: '12px',
    padding: '1rem',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
  },
  rateDisplay: {
    textAlign: 'center',
    marginBottom: '1rem'
  },
  rateValue: {
    fontSize: '2rem',
    fontWeight: '800'
  },
  progressBar: {
    height: '12px',
    background: '#e5e7eb',
    borderRadius: '6px',
    overflow: 'hidden',
    marginBottom: '0.75rem'
  },
  progressFill: {
    height: '100%',
    borderRadius: '6px',
    transition: 'width 0.4s'
  },
  rateDetails: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.5rem'
  },
  rateDetail: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.75rem',
    padding: '0.5rem',
    background: '#f9fafb',
    borderRadius: '6px'
  },
  rateDetailLabel: {
    color: '#6b7280'
  },
  rateDetailValue: {
    fontWeight: '600',
    color: '#1f2937'
  },

  // Source Card 样式
  sourceGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem'
  },
  sourceCard: {
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '0.75rem',
    textAlign: 'center',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  sourceIcon: {
    fontSize: '1.5rem',
    marginBottom: '0.25rem'
  },
  sourceLabel: {
    fontSize: '0.625rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  sourceValue: {
    fontSize: '0.875rem',
    fontWeight: '700'
  },

  // TL Stats Card 样式
  tlStatsCard: {
    background: 'white',
    borderRadius: '12px',
    padding: '1rem',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  tlStatRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem',
    background: '#f9fafb',
    borderRadius: '6px'
  },
  tlStatLabel: {
    fontSize: '0.8125rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  tlStatValue: {
    fontSize: '0.9375rem',
    fontWeight: '700'
  },

  // 其他样式
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem'
  },
  detailLabel: { color: '#6b7280' },
  detailValue: { fontWeight: '600', color: '#1f2937' }
};

export default OverviewStatsPhone;

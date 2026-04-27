/**
 * OverviewStats Component - 现金管理统计视图
 * 
 * 新模型聚焦：
 * - 显示应收现金统计（EM分配 + TL派发）
 * - 待支付 vs 已支付进度跟踪
 * - 学生支付状态分布
 * - 现金来源分解
 * - TeamLeader 现金账户概览
 *
 * @version 2026-04-26
 * @date 2026-04-26
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';

const OverviewStats = ({
  organizationId,
  eventId,
  teamLeaderId,
  managedDepartments,
  eventData,
  userInfo
}) => {
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(true);

  const effectiveManagedDepartments = Array.isArray(managedDepartments) && managedDepartments.length > 0
    ? managedDepartments
    : (userInfo?.teamLeader?.managedDepartments || userInfo?.managedDepartments || []);

  useEffect(() => {
    if (!organizationId || !eventId || !teamLeaderId) {
      setCustomers([]);
      setCustomersLoading(false);
      return;
    }

    if (!Array.isArray(effectiveManagedDepartments) || effectiveManagedDepartments.length === 0) {
      setCustomers([]);
      setCustomersLoading(false);
      return;
    }

    setCustomersLoading(true);

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
        setCustomersLoading(false);
      },
      (error) => {
        console.error('[OverviewStats] 加载 customers 失败:', error);
        setCustomers([]);
        setCustomersLoading(false);
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
        studentsNoCash: 0,
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
      studentsFullyPaid: 0,
      studentsNoCash: 0
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
        stats.studentsNoCash += 1;
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

  // 加载状态
  if (customersLoading) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>⏳</div>
        <p>加载现金统计中...</p>
      </div>
    );
  }

  // 获取进度条颜色
  const getProgressColor = (rate) => {
    if (rate >= 80) return '#10b981'; // 绿色
    if (rate >= 50) return '#f59e0b'; // 橙色
    return '#ef4444'; // 红色
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.sectionTitle}>💰 现金管理统计</h2>

      {/* 应收现金总体统计 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>📊 应收现金概览</h3>
        <div style={styles.statsGrid}>
          <StatCard
            icon="💵"
            title="应收总额"
            value={`RM ${(cashStats.totalAllocatedCash || 0).toLocaleString()}`}
            color="#ef4444"
            highlight
          />
          <StatCard
            icon="⏳"
            title="待支付"
            value={`RM ${(cashStats.pendingCash || 0).toLocaleString()}`}
            color="#f59e0b"
          />
          <StatCard
            icon="✅"
            title="已支付"
            value={`RM ${(cashStats.confirmedCash || 0).toLocaleString()}`}
            color="#10b981"
          />
          <StatCard
            icon="📈"
            title="收款率"
            value={`${Math.round(cashStats.collectionRate || 0)}%`}
            color={getProgressColor(cashStats.collectionRate || 0)}
            highlight
          />
        </div>
      </div>

      {/* 收款进度条 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>🎯 收款进度</h3>
        <div style={styles.progressSection}>
          <div style={styles.progressContainer}>
            <div style={styles.progressBar}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${Math.min(100, cashStats.collectionRate || 0)}%`,
                  background: getProgressColor(cashStats.collectionRate || 0)
                }}
              />
            </div>
          </div>
          <div style={styles.progressDetails}>
            <div style={styles.progressDetail}>
              <span style={styles.progressLabel}>已确认收款</span>
              <span style={{ ...styles.progressValue, color: '#10b981' }}>
                RM {(cashStats.confirmedCash || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.progressDetail}>
              <span style={styles.progressLabel}>待确认</span>
              <span style={{ ...styles.progressValue, color: '#f59e0b' }}>
                RM {(cashStats.pendingCash || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 现金来源分解 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>🔀 现金来源分解</h3>
        <div style={styles.sourceGrid}>
          <SourceCard
            icon="🏢"
            title="EventManager 分配"
            value={`RM ${(cashStats.emAllocatedCash || 0).toLocaleString()}`}
            percentage={
              cashStats.totalAllocatedCash > 0
                ? Math.round((cashStats.emAllocatedCash / cashStats.totalAllocatedCash) * 100)
                : 0
            }
            color="#3b82f6"
          />
          <SourceCard
            icon="👤"
            title="TeamLeader 派发"
            value={`RM ${(cashStats.tlAllocatedCash || 0).toLocaleString()}`}
            percentage={
              cashStats.totalAllocatedCash > 0
                ? Math.round((cashStats.tlAllocatedCash / cashStats.totalAllocatedCash) * 100)
                : 0
            }
            color="#8b5cf6"
          />
        </div>
      </div>

      {/* 学生支付状态统计 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>👥 学生支付状态</h3>
        <div style={styles.statusGrid}>
          <StatusCard
            icon="📚"
            title="总学生数"
            value={String(customers?.length || 0)}
            color="#6b7280"
          />
          <StatusCard
            icon="⏳"
            title="待支付"
            value={String(cashStats.studentsWithDebt || 0)}
            color="#f59e0b"
            alert={cashStats.studentsWithDebt > 0}
          />
          <StatusCard
            icon="✨"
            title="已全额支付"
            value={String(cashStats.studentsFullyPaid || 0)}
            color="#10b981"
          />
          <StatusCard
            icon="⭕"
            title="无应收"
            value={String(cashStats.studentsNoCash || 0)}
            color="#6366f1"
          />
        </div>
      </div>

      {/* TeamLeader 现金账户 */}
      <div style={styles.section}>
        <h3 style={styles.subsectionTitle}>🏦 我的现金账户</h3>
        <div style={styles.tlCashSection}>
          <div style={styles.tlCashCard}>
            <div style={styles.tlCashRow}>
              <span style={styles.tlCashLabel}>待确认收款</span>
              <span style={{ ...styles.tlCashValue, color: '#f59e0b' }}>
                RM {(teamLeaderCashStats.pendingFromCustomers || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.tlCashRow}>
              <span style={styles.tlCashLabel}>已确认收到</span>
              <span style={{ ...styles.tlCashValue, color: '#10b981' }}>
                RM {(teamLeaderCashStats.confirmedFromCustomers || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.tlCashRow}>
              <span style={styles.tlCashLabel}>当前持有</span>
              <span style={{ ...styles.tlCashValue, color: '#3b82f6', fontSize: '1.5rem', fontWeight: 'bold' }}>
                RM {(teamLeaderCashStats.cashOnHand || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.tlCashRow}>
              <span style={styles.tlCashLabel}>已上交</span>
              <span style={{ ...styles.tlCashValue, color: '#8b5cf6' }}>
                RM {(teamLeaderCashStats.totalSubmitted || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 风险提示 */}
      {cashStats.studentsWithDebt > 0 && (
        <div style={styles.section}>
          <div style={styles.alertBox}>
            <span style={styles.alertIcon}>⚠️</span>
            <span style={styles.alertText}>
              有 {cashStats.studentsWithDebt} 位学生待支付现金，总额 RM {(cashStats.pendingCash || 0).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// StatCard 组件 - 主要统计卡片
const StatCard = ({ icon, title, value, color, highlight, subtitle, description }) => (
  <div style={{
    ...styles.statCard,
    borderLeft: `4px solid ${color}`,
    background: highlight ? `${color}15` : 'transparent'
  }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <div style={styles.statTitle}>{title}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      {subtitle && <div style={styles.statSubtitle}>{subtitle}</div>}
      {description && <div style={styles.statDescription}>{description}</div>}
    </div>
  </div>
);

// SourceCard 组件 - 现金来源卡片
const SourceCard = ({ icon, title, value, percentage, color }) => (
  <div style={{ ...styles.sourceCard, borderTop: `3px solid ${color}` }}>
    <div style={styles.sourceHeader}>
      <span style={styles.sourceIcon}>{icon}</span>
      <span style={styles.sourceTitle}>{title}</span>
    </div>
    <div style={{ ...styles.sourceValue, color }}>{value}</div>
    <div style={styles.sourcePercentage}>
      <div style={styles.percentageBar}>
        <div
          style={{
            ...styles.percentageFill,
            width: `${percentage}%`,
            background: color
          }}
        />
      </div>
      <span style={styles.percentageText}>{percentage}%</span>
    </div>
  </div>
);

// StatusCard 组件 - 学生状态卡片
const StatusCard = ({ icon, title, value, color, alert }) => (
  <div style={{
    ...styles.statusCard,
    borderLeft: `3px solid ${color}`,
    background: alert ? `${color}20` : 'transparent'
  }}>
    <div style={styles.statusIcon}>{icon}</div>
    <div style={styles.statusTitle}>{title}</div>
    <div style={{ ...styles.statusValue, color }}>{value}</div>
  </div>
);

// 样式定义
const styles = {
  container: {
    padding: '1.5rem',
    background: '#f9fafb',
    borderRadius: '0.5rem',
    color: '#1f2937'
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: '1.5rem',
    color: '#111827'
  },
  section: {
    marginBottom: '2rem',
    background: 'white',
    padding: '1.5rem',
    borderRadius: '0.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  subsectionTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: '#374151'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem'
  },
  statCard: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    borderRadius: '0.375rem',
    background: '#f3f4f6',
    alignItems: 'center'
  },
  statIcon: {
    fontSize: '2rem',
    minWidth: '3rem',
    textAlign: 'center'
  },
  statContent: {
    flex: 1
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold'
  },
  statSubtitle: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  statDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  progressSection: {
    background: '#f3f4f6',
    padding: '1.5rem',
    borderRadius: '0.375rem'
  },
  progressContainer: {
    marginBottom: '1rem'
  },
  progressBar: {
    height: '1.5rem',
    background: '#e5e7eb',
    borderRadius: '0.25rem',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease'
  },
  progressDetails: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem'
  },
  progressDetail: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  progressLabel: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  progressValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold'
  },
  sourceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem'
  },
  sourceCard: {
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '0.375rem'
  },
  sourceHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.75rem'
  },
  sourceIcon: {
    fontSize: '1.5rem'
  },
  sourceTitle: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151'
  },
  sourceValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    marginBottom: '0.75rem'
  },
  sourcePercentage: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  percentageBar: {
    flex: 1,
    height: '0.5rem',
    background: '#e5e7eb',
    borderRadius: '0.125rem',
    overflow: 'hidden'
  },
  percentageFill: {
    height: '100%'
  },
  percentageText: {
    fontSize: '0.75rem',
    fontWeight: '600',
    minWidth: '2.5rem',
    textAlign: 'right',
    color: '#6b7280'
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '1rem'
  },
  statusCard: {
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '0.375rem',
    textAlign: 'center'
  },
  statusIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem'
  },
  statusTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
  },
  statusValue: {
    fontSize: '1.75rem',
    fontWeight: 'bold'
  },
  tlCashSection: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '1.5rem',
    borderRadius: '0.5rem'
  },
  tlCashCard: {
    background: 'rgba(255, 255, 255, 0.95)',
    padding: '1.5rem',
    borderRadius: '0.375rem'
  },
  tlCashRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '1rem',
    borderBottom: '1px solid #e5e7eb'
  },
  tlCashRow_last: {
    borderBottom: 'none'
  },
  tlCashLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  tlCashValue: {
    fontSize: '1.125rem',
    fontWeight: 'bold'
  },
  alertBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '0.375rem'
  },
  alertIcon: {
    fontSize: '1.5rem',
    flexShrink: 0
  },
  alertText: {
    fontSize: '0.875rem',
    color: '#7f1d1d'
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

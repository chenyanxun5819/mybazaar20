import { useState, useMemo } from 'react';
import { useManagedUsers } from '../../../../hooks/teamLeader';
import { maskPhoneNumber } from '../../../../services/transactionService';

/**
 * SellerListPhone
 *
 * 卡片式卖家列表，每张卡片显示关键信息 + 「分配点数」按钮。
 *
 * Props:
 *   userInfo        - 当前登录的 Team Leader 信息
 *   onAllocate(seller) - 点击「分配点数」时的回调，切换到分配 tab
 */
const SellerListPhone = ({ userInfo, onAllocate }) => {
  const orgId = userInfo?.organizationId;
  const eventId = userInfo?.eventId;
  const smId = userInfo?.userId;

  const { users, loading, error } = useManagedUsers(orgId, eventId, smId);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredSellers = useMemo(() => {
    let list = Array.isArray(users) ? [...users] : [];

    // 搜索
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(s =>
        s.basicInfo?.chineseName?.toLowerCase().includes(term) ||
        s.basicInfo?.englishName?.toLowerCase().includes(term) ||
        s.identityInfo?.department?.toLowerCase().includes(term)
      );
    }

    // 状态筛选
    if (filterStatus === 'warning') {
      list = list.filter(s => s.pointSeller?.collectionAlert?.hasWarning);
    } else if (filterStatus === 'active') {
      list = list.filter(s => (s.pointSeller?.totalRevenue || 0) > 0);
    }

    return list;
  }, [users, searchTerm, filterStatus]);

  if (loading) {
    return (
      <div style={styles.centered}>
        <p style={{ color: '#6b7280' }}>加载卖家列表...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.centered}>
        <p style={{ color: '#ef4444' }}>加载失败，请刷新重试</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 搜索栏 */}
      <input
        type="text"
        placeholder="搜索姓名或班级..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        style={styles.searchInput}
      />

      {/* 筛选 */}
      <div style={styles.filterRow}>
        {[
          { key: 'all', label: `全部 (${users.length})` },
          { key: 'warning', label: '⚠️ 有警示' },
          { key: 'active', label: '有销售' }
        ].map(f => (
          <button
            key={f.key}
            style={{
              ...styles.filterBtn,
              ...(filterStatus === f.key ? styles.filterBtnActive : {})
            }}
            onClick={() => setFilterStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 卡片列表 */}
      {filteredSellers.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>👥</div>
          <p>{searchTerm ? '没有符合搜索的卖家' : '暂无卖家'}</p>
        </div>
      ) : (
        <div style={styles.cardList}>
          {filteredSellers.map(seller => (
            <SellerCard
              key={seller.id}
              seller={seller}
              onAllocate={() => onAllocate?.(seller)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SellerCard = ({ seller, onAllocate }) => {
  const name =
    seller.basicInfo?.chineseName ||
    seller.basicInfo?.englishName ||
    '未知';
  const dept = seller.identityInfo?.department || '未分配部门';
  const sellerData = seller.pointSeller || {};
  const balance = sellerData.availablePoints || 0;
  const revenue = sellerData.totalRevenue || 0;
  const collected = sellerData.totalCashCollected || 0;
  const pending = Math.max(0, revenue - collected);
  const collectionRate = revenue > 0 ? collected / revenue : 0;
  const hasWarning = seller.pointSeller?.collectionAlert?.hasWarning;

  const rateColor =
    collectionRate >= 0.8 ? '#10b981' : collectionRate >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div style={styles.card} onClick={onAllocate}>
      {/* 卡片头部 */}
      <div style={styles.cardHeader}>
        <div style={styles.cardName}>{name} <span style={styles.cardId}>{seller.identityInfo?.identityId || ''}</span></div>
        <div style={styles.cardPhone}>{maskPhoneNumber(seller.basicInfo?.phoneNumber || '')}</div>
        {hasWarning && <span style={styles.warningBadge}>⚠️</span>}
      </div>

      {/* 数据行 */}
      <div style={styles.statsRow}>
        <MiniStat label="余额" value={`${balance.toLocaleString()} 点`} />
        <MiniStat label="累计销售" value={revenue.toLocaleString()} />
        <MiniStat
          label="收款率"
          value={`${Math.round(collectionRate * 100)}%`}
          valueColor={rateColor}
        />
      </div>

      {pending > 0 && (
        <div style={styles.pendingRow}>
          <span style={styles.pendingLabel}>待收款</span>
          <span style={styles.pendingValue}>RM {pending.toLocaleString()}</span>
        </div>
      )}

      {/* 底部分隔线 */}
      <div style={styles.divider} />
    </div>
  );
};

const MiniStat = ({ label, value, valueColor }) => (
  <div style={styles.miniStat}>
    <div style={{ ...styles.miniValue, ...(valueColor ? { color: valueColor } : {}) }}>
      {value}
    </div>
    <div style={styles.miniLabel}>{label}</div>
  </div>
);

const styles = {
  container: { paddingBottom: '1rem' },
  centered: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  searchInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    marginBottom: '0.75rem',
    boxSizing: 'border-box',
    outline: 'none'
  },
  filterRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
    flexWrap: 'wrap'
  },
  filterBtn: {
    padding: '0.375rem 0.875rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: '20px',
    background: 'white',
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: '#6b7280',
    cursor: 'pointer'
  },
  filterBtnActive: {
    borderColor: '#f59e0b',
    background: '#fef3c7',
    color: '#92400e'
  },
  empty: {
    textAlign: 'center',
    padding: '3rem',
    color: '#9ca3af'
  },
  emptyIcon: { fontSize: '3rem', marginBottom: '0.75rem' },
  cardList: { display: 'flex', flexDirection: 'column', gap: '0' },
  card: {
    background: 'transparent',
    padding: '0.5rem 0.75rem',
    cursor: 'pointer'
  },
  cardWarning: {
    borderColor: '#fbbf24',
    background: '#fffbeb'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '0.25rem'
  },
  avatar: {
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.25rem',
    fontWeight: 'bold',
    flexShrink: 0
  },
  cardInfo: { flex: 1 },
  cardName: { fontSize: '0.9375rem', fontWeight: '700', color: '#1f2937' },
  cardId: { fontWeight: '400', fontSize: '0.8125rem', color: '#9ca3af', marginLeft: '0.375rem' },
  cardPhone: { fontSize: '0.75rem', color: '#6b7280', flexShrink: 0 },
  warningBadge: { fontSize: '1.25rem' },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.25rem',
    marginBottom: '0.25rem',
    background: '#f9fafb',
    borderRadius: '6px',
    padding: '0.375rem 0.5rem'
  },
  miniStat: { textAlign: 'center' },
  miniValue: { fontSize: '0.8125rem', fontWeight: '700', color: '#1f2937', marginBottom: '0.1rem' },
  miniLabel: { fontSize: '0.625rem', color: '#9ca3af' },
  pendingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#fef3c7',
    padding: '0.25rem 0.75rem',
    borderRadius: '6px',
    marginBottom: '0.25rem'
  },
  pendingLabel: { fontSize: '0.75rem', color: '#92400e', fontWeight: '500' },
  pendingValue: { fontSize: '0.8125rem', fontWeight: '700', color: '#92400e' },
  allocateBtn: {
    padding: '0.5rem 0.875rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.8125rem',
    fontWeight: '700',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0
  },
  divider: {
    height: '1px',
    background: '#e5e7eb',
    marginTop: '0.375rem'
  }
};

export default SellerListPhone;

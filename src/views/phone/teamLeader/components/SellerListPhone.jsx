import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../../../../config/firebase';
import { maskPhoneNumber } from '../../../../services/transactionService';
import TransactionPinDialog from '../../../../components/common/TransactionPinDialog';

/**
 * CustomerListPhone (重构版)
 *
 * 卡片式学生列表，每张卡片显示关键信息 + 「分配点数」按钮。
 * 
 * 架构对应：
 * - customer.cashAccount.pendingCash - 待支付现金
 * - customer.cashAccount.confirmedCash - 已支付现金
 * - customer.cashAccount.totalAllocatedCash - 应收现金总额
 *
 * Props:
 *   userInfo        - 当前登录的 Team Leader 信息
 *   onAllocate(customer) - 点击「分配点数」时的回调，切换到分配 tab
 */
const CustomerListPhone = ({ userInfo, onAllocate }) => {
  const orgId = userInfo?.organizationId;
  const eventId = userInfo?.eventId;
  const teamLeaderId = userInfo?.userId;
  const managedDepartments = userInfo?.managedDepartments || [];

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [confirmingPayment, setConfirmingPayment] = useState(null);
  const [showPinDialog, setShowPinDialog] = useState(null); // { type: 'payment'|'allocate', customer }
  const [pendingPaymentData, setPendingPaymentData] = useState(null);

  // 加载 Customers 数据
  useEffect(() => {
    if (!orgId || !eventId || !Array.isArray(managedDepartments) || managedDepartments.length === 0) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const collectionPath = `organizations/${orgId}/events/${eventId}/users`;
      const q = query(
        collection(db, collectionPath),
        where('roles', 'array-contains', 'customer')
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const list = [];
          
          snapshot.forEach(doc => {
            const data = doc.data() || {};
            
            // 只保留在当前 Team Leader 管理的部门内的 customers
            if (managedDepartments.includes(data.identityInfo?.department)) {
              list.push({
                id: doc.id,
                userId: doc.id,
                ...data
              });
            }
          });

          // 按创建时间排序（最新的在前）
          list.sort((a, b) => {
            const timeA = (a.accountStatus?.createdAt?.toMillis) ? a.accountStatus.createdAt.toMillis() : 0;
            const timeB = (b.accountStatus?.createdAt?.toMillis) ? b.accountStatus.createdAt.toMillis() : 0;
            return timeB - timeA;
          });

          setCustomers(list);
          setLoading(false);
          setError(null);
        },
        (err) => {
          console.error('[CustomerListPhone] 查询失败:', err);
          setError(err);
          setLoading(false);
        }
      );

      return unsubscribe;
    } catch (err) {
      console.error('[CustomerListPhone] 设置查询异常:', err);
      setError(err);
      setLoading(false);
    }
  }, [orgId, eventId, managedDepartments]);

  const filteredCustomers = useMemo(() => {
    let list = Array.isArray(customers) ? [...customers] : [];

    // 搜索
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(c =>
        c.basicInfo?.chineseName?.toLowerCase().includes(term) ||
        c.basicInfo?.englishName?.toLowerCase().includes(term) ||
        c.identityInfo?.department?.toLowerCase().includes(term)
      );
    }

    // 状态筛选
    if (filterStatus === 'pending') {
      list = list.filter(c => (c.customer?.cashAccount?.pendingCash || 0) > 0);
    } else if (filterStatus === 'active') {
      list = list.filter(c => (c.customer?.cashAccount?.totalAllocatedCash || 0) > 0);
    }

    return list;
  }, [customers, searchTerm, filterStatus]);

  // ========== 收取现金逻辑 ==========
  const handleConfirmPayment = async (customer) => {
    const cashAccount = customer.customer?.cashAccount || {};
    const pendingAmount = cashAccount.pendingCash || 0;

    if (pendingAmount <= 0) {
      window.mybazaarShowToast('该学生没有待支付现金');
      return;
    }

    // 确认操作
    if (!window.confirm(
      `确认从 ${customer.basicInfo?.chineseName || '未知'} 收取现金 RM ${pendingAmount}？\n\n` +
      `学号: ${customer.identityInfo?.identityId || '未知'}\n` +
      `部门: ${customer.identityInfo?.department || '未知'}`
    )) {
      return;
    }

    if (!teamLeaderId) {
      window.mybazaarShowToast('❌ 错误：无法获取当前用户信息');
      return;
    }

    setConfirmingPayment(customer.userId);

    try {
      const batch = writeBatch(db);

      // 1. 更新 Customer 的现金账户
      const customerRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${customer.userId}`);

      batch.update(customerRef, {
        // 减少待支付现金
        'customer.cashAccount.pendingCash': increment(-pendingAmount),
        // 增加已支付现金
        'customer.cashAccount.confirmedCash': increment(pendingAmount),
        // 更新最后支付时间
        'customer.cashAccount.lastConfirmedAt': serverTimestamp(),
        'updatedAt': serverTimestamp()
      });

      // 2. 创建 cashCollection 记录（用于财务追踪）
      const collectionsRef = collection(db, `organizations/${orgId}/events/${eventId}/cashCollections`);
      const collectionDocRef = doc(collectionsRef);

      batch.set(collectionDocRef, {
        collectionId: collectionDocRef.id,
        type: 'customerToTeamLeader',
        collectedBy: teamLeaderId,
        collectedByName: userInfo?.basicInfo?.chineseName || 'Team Leader',
        collectedByRole: 'teamLeader',
        collectedByDepartment: userInfo?.identityInfo?.department || '',
        submittedBy: customer.userId,
        submittedByName: customer.basicInfo?.chineseName || '未知',
        submittedByRole: 'customer',
        submittedByDepartment: customer.identityInfo?.department || '',
        customerId: customer.userId,
        customerDepartment: customer.identityInfo?.department || '',
        amount: pendingAmount,
        pointsValue: pendingAmount,
        status: 'collected',
        collectedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
        organizationId: orgId,
        eventId: eventId,
        note: `确认收取应付现金`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 3. 更新 TeamLeader 的现金统计
      const teamLeaderRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${teamLeaderId}`);

      batch.update(teamLeaderRef, {
        // 减少待确认现金
        'teamLeader.cashStats.pendingFromCustomers': increment(-pendingAmount),
        // 增加已确认现金
        'teamLeader.cashStats.confirmedFromCustomers': increment(pendingAmount),
        // 增加当前持有现金
        'teamLeader.cashStats.cashOnHand': increment(pendingAmount),
        // 累计收款
        'teamLeader.cashStats.totalReceivedFromCustomers': increment(pendingAmount),
        // 更新时间戳
        'teamLeader.cashStats.lastConfirmedAt': serverTimestamp(),
        'updatedAt': serverTimestamp()
      });

      await batch.commit();

      window.mybazaarShowToast(`✅ 成功确认收取 RM ${pendingAmount} 从 ${customer.basicInfo?.chineseName || '未知'}`);

    } catch (error) {
      console.error('❌ 确认收款失败:', error);
      window.mybazaarShowToast('确认收款失败，请重试。错误: ' + error.message);
    } finally {
      setConfirmingPayment(null);
    }
  };

  if (loading) {
    return (
      <div style={styles.centered}>
        <p style={{ color: '#6b7280' }}>加载学生列表...</p>
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
          { key: 'all', label: `全部 (${customers.length})` },
          { key: 'pending', label: '💰 收款' },
          { key: 'active', label: '有应收' }
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
      {filteredCustomers.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>👥</div>
          <p>{searchTerm ? '没有符合搜索的学生' : '暂无学生'}</p>
        </div>
      ) : (
        <div style={styles.cardList}>
          {filteredCustomers.map(customer => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              onAllocate={() => onAllocate?.(customer)}
              onConfirmPayment={() => handleConfirmPayment(customer)}
              isConfirming={confirmingPayment === customer.userId}
              onShowPinDialog={(type, cust) => setShowPinDialog({ type, customer: cust })}
            />
          ))}
        </div>
      )}

      {/* PIN 验证对话框 - 收款 */}
      {showPinDialog?.type === 'payment' && (
        <TransactionPinDialog
          title="🔐 确认收款密码"
          message={`请输入交易密码来确认收取现金 RM ${showPinDialog.customer.customer?.cashAccount?.pendingCash || 0}`}
          onConfirm={async (pin) => {
            try {
              await handleConfirmPayment(showPinDialog.customer);
              setShowPinDialog(null);
              window.mybazaarShowToast('✅ 收款已确认');
            } catch (err) {
              throw new Error(err.message || '收款失败');
            }
          }}
          onCancel={() => setShowPinDialog(null)}
          confirmButtonText="✅ 确认收款"
        />
      )}

      {/* PIN 验证对话框 - 分配点数 */}
      {showPinDialog?.type === 'allocate' && (
        <TransactionPinDialog
          title="🔐 确认分配密码"
          message="请输入交易密码来确认分配点数"
          onConfirm={async (pin) => {
            try {
              onAllocate?.(showPinDialog.customer);
              setShowPinDialog(null);
            } catch (err) {
              throw new Error(err.message || '分配失败');
            }
          }}
          onCancel={() => setShowPinDialog(null)}
          confirmButtonText="✅ 确认分配"
        />
      )}
    </div>
  );
};

const CustomerCard = ({ customer, onAllocate, onConfirmPayment, isConfirming, onShowPinDialog }) => {
  const name =
    customer.basicInfo?.chineseName ||
    customer.basicInfo?.englishName ||
    '未知';
  const dept = customer.identityInfo?.department || '未分配部门';
  const cashAccount = customer.customer?.cashAccount || {};
  
  // 现金字段
  const totalAllocated = cashAccount.totalAllocatedCash || 0;
  const pendingCash = cashAccount.pendingCash || 0;
  const confirmedCash = cashAccount.confirmedCash || 0;
  
  // 点数字段
  const pointsAccount = customer.customer?.pointsAccount || {};
  const availablePoints = pointsAccount.availablePoints || 0;

  const collectionRate = totalAllocated > 0 ? confirmedCash / totalAllocated : 0;
  const hasPending = pendingCash > 0;

  const rateColor =
    collectionRate >= 0.8 ? '#10b981' : collectionRate >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div style={styles.card}>
      {/* 卡片头部 */}
      <div style={styles.cardHeader}>
        <div style={styles.cardName}>{name} <span style={styles.cardId}>{customer.identityInfo?.identityId || ''}</span></div>
        <div style={styles.cardPhone}>{maskPhoneNumber(customer.basicInfo?.phoneNumber || '')}</div>
        {hasPending && <span style={styles.warningBadge}>⏳</span>}
      </div>

      {/* 数据行 */}
      <div style={styles.statsRow}>
        <MiniStat label="可用点数" value={`${availablePoints.toLocaleString()} 点`} />
        <MiniStat label="应收总额" value={`RM ${totalAllocated.toLocaleString()}`} />
        <MiniStat
          label="支付率"
          value={`${Math.round(collectionRate * 100)}%`}
          valueColor={rateColor}
        />
      </div>

      {/* 按钮行 */}
      <div style={styles.buttonRow}>
        {pendingCash > 0 && (
          <button
            onClick={() => onShowPinDialog('payment', customer)}
            disabled={isConfirming}
            style={{
              ...styles.actionBtn,
              background: '#10b981',
              opacity: isConfirming ? 0.5 : 1
            }}
          >
            {isConfirming ? '处理中...' : `收款 RM ${pendingCash.toLocaleString()}`}
          </button>
        )}
        <button
          onClick={() => onShowPinDialog('allocate', customer)}
          style={{
            ...styles.actionBtn,
            background: '#f59e0b'
          }}
        >
          分配点数
        </button>
      </div>

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
    padding: '0.5rem 0.75rem'
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
  buttonRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.25rem',
    flexWrap: 'wrap'
  },
  actionBtn: {
    flex: '1',
    minWidth: '120px',
    padding: '0.5rem 0.75rem',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.75rem',
    fontWeight: '600',
    cursor: 'pointer',
    color: 'white',
    transition: 'all 0.2s'
  },
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

export default CustomerListPhone;

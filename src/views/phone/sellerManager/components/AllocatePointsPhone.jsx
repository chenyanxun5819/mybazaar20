import { useState } from 'react';
import { auth } from '../../../../config/firebase';
import { safeFetch } from '../../../../services/safeFetch';
import { useManagedUsers } from '../../../../hooks/sellerManager';

/**
 * AllocatePointsPhone
 *
 * 手机版分配点数（销售点数给卖家，收取现金）。
 *
 * 两种使用模式：
 *   1. 从「卖家」tab 点击「分配点数」跳过来 → selectedSeller 已设定
 *   2. 直接进入「分配」tab → 先选卖家，再操作
 *
 * Props:
 *   userInfo         - Seller Manager 用户信息
 *   selectedSeller   - 外部传入的预选 seller（可为 null）
 *   onSelectSeller   - 更新外部预选 seller 的回调
 *   organizationId
 *   eventId
 *   maxPerAllocation
 */
const AllocatePointsPhone = ({
  userInfo,
  selectedSeller,
  onSelectSeller,
  organizationId,
  eventId,
  maxPerAllocation = 100
}) => {
  const orgId = userInfo?.organizationId;
  const smId = userInfo?.userId;

  const { users, loading: usersLoading } = useManagedUsers(orgId, eventId, smId);

  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const quickAmounts = [10, 20, 50, 100, 200, 500].filter(a => a <= maxPerAllocation);

  const filteredUsers = (users || []).filter(u => {
    const name =
      (u.basicInfo?.chineseName || '') + (u.basicInfo?.englishName || '');
    const dept = u.identityInfo?.department || '';
    const term = searchTerm.toLowerCase();
    return name.toLowerCase().includes(term) || dept.toLowerCase().includes(term);
  });

  const handleSubmit = async () => {
    if (!selectedSeller) {
      setError('请先选择一位卖家');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效点数');
      return;
    }
    const pts = parseFloat(amount);
    if (isNaN(pts)) { setError('点数必须是数字'); return; }
    if (pts > maxPerAllocation) { setError(`单次最多 ${maxPerAllocation} 点`); return; }

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('未登录，请重新登录');
      const token = await user.getIdToken();

      const response = await safeFetch('/api/allocatePointsBySellerManager', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          recipientId: selectedSeller.id,
          points: pts,
          allocationType: 'personal',
          notes: notes || ''
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '销售失败');

      const sellerName =
        selectedSeller.basicInfo?.chineseName ||
        selectedSeller.basicInfo?.englishName;
      setSuccessMessage(`✅ 成功销售 ${pts} 点给 ${sellerName}（收现金 RM ${pts}）`);
      setAmount('');
      setNotes('');

      setTimeout(() => {
        setSuccessMessage('');
        onSelectSeller?.(null);
      }, 2500);
    } catch (err) {
      console.error('[AllocatePhone] 销售失败:', err);
      setError(err.message || '销售失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // ===== 如果还没选 seller，显示选择列表 =====
  if (!selectedSeller) {
    return (
      <div style={styles.container}>
        <p style={styles.hint}>请先从列表选择一位卖家来分配点数</p>

        <input
          type="text"
          placeholder="搜索姓名或班级..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        {usersLoading ? (
          <div style={styles.centered}><p style={{ color: '#6b7280' }}>加载中...</p></div>
        ) : filteredUsers.length === 0 ? (
          <div style={styles.centered}><p style={{ color: '#9ca3af' }}>没有符合的卖家</p></div>
        ) : (
          <div style={styles.pickList}>
            {filteredUsers.map(seller => {
              const name =
                seller.basicInfo?.chineseName ||
                seller.basicInfo?.englishName ||
                '未知';
              const dept = seller.identityInfo?.department || '-';
              const balance = seller.seller?.availablePoints || 0;
              return (
                <button
                  key={seller.id}
                  style={styles.pickItem}
                  onClick={() => { onSelectSeller?.(seller); setSearchTerm(''); }}
                >
                  <div style={styles.pickAvatar}>
                    {(name[0] || '?').toUpperCase()}
                  </div>
                  <div style={styles.pickInfo}>
                    <div style={styles.pickName}>{name}</div>
                    <div style={styles.pickMeta}>🏫 {dept} &nbsp;·&nbsp; 余额: {balance.toLocaleString()} 点</div>
                  </div>
                  <span style={styles.pickArrow}>›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ===== 已选 seller：显示分配表单 =====
  const sellerName =
    selectedSeller.basicInfo?.chineseName ||
    selectedSeller.basicInfo?.englishName ||
    '未知';
  const sellerData = selectedSeller.seller || {};
  const balance = selectedSeller.customer?.pointsAccount?.availablePoints || 0;
  const revenue = sellerData.totalRevenue || 0;
  const collected = sellerData.totalCashCollected || 0;
  const collectionRate = revenue > 0 ? collected / revenue : 0;
  const expectedBalance = balance + (parseFloat(amount) || 0);
  const hasWarning = sellerData.collectionAlert?.hasWarning;

  return (
    <div style={styles.container}>
      {/* 已选卖家卡片 */}
      <div style={styles.sellerCard}>
        <div style={styles.sellerAvatar}>
          {(sellerName[0] || '?').toUpperCase()}
        </div>
        <div style={styles.sellerInfo}>
          <div style={styles.sellerName}>{sellerName}</div>
          <div style={styles.sellerDept}>
            🏫 {selectedSeller.identityInfo?.department || '未分配部门'}
          </div>
        </div>
        <button
          style={styles.changeBtn}
          onClick={() => { onSelectSeller?.(null); setAmount(''); setError(''); setSuccessMessage(''); }}
        >
          更换
        </button>
      </div>

      {/* 收款警示 */}
      {hasWarning && (
        <div style={styles.warningBox}>
          ⚠️ 待收款 RM {(sellerData.collectionAlert?.pendingAmount || 0).toLocaleString()}
        </div>
      )}

      {/* 当前余额摘要 */}
      <div style={styles.balanceRow}>
        <span style={styles.balanceLabel}>当前余额</span>
        <span style={styles.balanceValue}>{balance.toLocaleString()} 点</span>
      </div>
      <div style={styles.balanceRow}>
        <span style={styles.balanceLabel}>收款率</span>
        <span style={{
          ...styles.balanceValue,
          color: collectionRate >= 0.8 ? '#10b981' : collectionRate >= 0.5 ? '#f59e0b' : '#ef4444'
        }}>
          {Math.round(collectionRate * 100)}%
        </span>
      </div>

      {/* 快速金额 */}
      <div style={styles.quickGrid}>
        {quickAmounts.map(a => (
          <button
            key={a}
            style={{
              ...styles.quickBtn,
              ...(amount === a.toString() ? styles.quickBtnActive : {})
            }}
            onClick={() => { setAmount(a.toString()); setError(''); }}
            disabled={loading}
          >
            {a}
          </button>
        ))}
      </div>

      {/* 自定义输入 */}
      <div style={styles.inputGroup}>
        <label style={styles.label}>
          点数 <span style={{ color: '#ef4444' }}>*</span>
          <span style={styles.labelHint}>（上限 {maxPerAllocation}，需收现金 RM {amount || 0}）</span>
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setError(''); }}
          placeholder="输入点数..."
          style={{ ...styles.input, ...(error ? styles.inputError : {}) }}
          disabled={loading}
        />
      </div>

      {/* 备注 */}
      <div style={styles.inputGroup}>
        <label style={styles.label}>备注（可选）</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="添加备注..."
          rows={2}
          style={styles.textarea}
          disabled={loading}
        />
      </div>

      {/* 预览 */}
      {amount && parseFloat(amount) > 0 && (
        <div style={styles.preview}>
          <div style={styles.previewRow}>
            <span>销售后余额</span>
            <strong style={{ color: '#10b981', fontSize: '1.125rem' }}>
              {expectedBalance.toLocaleString()} 点
            </strong>
          </div>
          <div style={{ ...styles.previewRow, ...styles.cashRow }}>
            <span style={{ fontWeight: '600', color: '#92400e' }}>💵 收取现金</span>
            <strong style={{ color: '#92400e', fontSize: '1.25rem' }}>
              RM {parseFloat(amount).toLocaleString()}
            </strong>
          </div>
        </div>
      )}

      {/* 错误 / 成功 */}
      {error && <div style={styles.errorBox}>{error}</div>}
      {successMessage && <div style={styles.successBox}>{successMessage}</div>}

      {/* 提交 */}
      <button
        style={{
          ...styles.submitBtn,
          opacity: loading ? 0.6 : 1,
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? '处理中...' : '💰 直接销售（收现金）'}
      </button>
    </div>
  );
};

const styles = {
  container: { paddingBottom: '1.5rem' },
  centered: { textAlign: 'center', padding: '2rem', color: '#6b7280' },
  hint: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.75rem',
    textAlign: 'center'
  },
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
  pickList: { display: 'flex', flexDirection: 'column', gap: '0.625rem' },
  pickItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    background: 'white',
    border: '1.5px solid #e5e7eb',
    borderRadius: '12px',
    padding: '0.875rem',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%'
  },
  pickAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.125rem',
    fontWeight: 'bold',
    flexShrink: 0
  },
  pickInfo: { flex: 1 },
  pickName: { fontSize: '0.9375rem', fontWeight: '600', color: '#1f2937', marginBottom: '0.2rem' },
  pickMeta: { fontSize: '0.75rem', color: '#9ca3af' },
  pickArrow: { fontSize: '1.25rem', color: '#d1d5db' },

  sellerCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    background: '#f0f9ff',
    border: '1.5px solid #bfdbfe',
    borderRadius: '12px',
    padding: '0.875rem',
    marginBottom: '0.875rem'
  },
  sellerAvatar: {
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.25rem',
    fontWeight: 'bold',
    flexShrink: 0
  },
  sellerInfo: { flex: 1 },
  sellerName: { fontSize: '1rem', fontWeight: '700', color: '#1e3a8a', marginBottom: '0.2rem' },
  sellerDept: { fontSize: '0.8125rem', color: '#3b82f6' },
  changeBtn: {
    padding: '0.375rem 0.875rem',
    background: 'white',
    border: '1.5px solid #bfdbfe',
    borderRadius: '8px',
    fontSize: '0.8125rem',
    fontWeight: '600',
    color: '#3b82f6',
    cursor: 'pointer'
  },
  warningBox: {
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    color: '#92400e',
    padding: '0.625rem 0.875rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    marginBottom: '0.875rem'
  },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#f9fafb',
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    marginBottom: '0.5rem'
  },
  balanceLabel: { fontSize: '0.875rem', color: '#6b7280' },
  balanceValue: { fontSize: '1rem', fontWeight: '700', color: '#1f2937' },
  quickGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.5rem',
    marginTop: '0.875rem',
    marginBottom: '0.875rem'
  },
  quickBtn: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    background: 'white',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer'
  },
  quickBtnActive: {
    borderColor: '#f59e0b',
    background: '#fef3c7',
    color: '#92400e'
  },
  inputGroup: { marginBottom: '0.875rem' },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.375rem'
  },
  labelHint: { fontWeight: '400', color: '#9ca3af', marginLeft: '0.375rem' },
  input: {
    width: '100%',
    padding: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '1.125rem',
    boxSizing: 'border-box',
    outline: 'none'
  },
  inputError: { borderColor: '#ef4444' },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    boxSizing: 'border-box',
    resize: 'vertical',
    fontFamily: 'inherit',
    outline: 'none'
  },
  preview: {
    background: '#f0f9ff',
    border: '1.5px solid #bfdbfe',
    borderRadius: '10px',
    padding: '0.875rem',
    marginBottom: '0.875rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  previewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.9375rem',
    color: '#374151'
  },
  cashRow: {
    marginTop: '0.25rem',
    padding: '0.625rem',
    background: '#fef3c7',
    borderRadius: '8px'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    marginBottom: '0.875rem',
    border: '1px solid #fecaca'
  },
  successBox: {
    background: '#d1fae5',
    color: '#065f46',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    marginBottom: '0.875rem',
    border: '1px solid #6ee7b7'
  },
  submitBtn: {
    width: '100%',
    padding: '1rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '700',
    cursor: 'pointer'
  }
};

export default AllocatePointsPhone;

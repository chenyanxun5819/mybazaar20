import { useState } from 'react';
import { auth } from '../../../config/firebase';
import { safeFetch } from '../../../services/safeFetch';
/**
 * Allocate Points Modal (简化版 - 只销售点数)
 * 
 * @description
 * Seller Manager 销售点数给 Seller（收现金）
 * - Seller 付现金购买点数
 * - 更新 customer.pointsAccount.availablePoints
 * - 记录现金收入
 * 
 * @version 3.1
 * @date 2026-01-12
 */

const AllocatePoints = ({
  seller,
  sellerManager,
  organizationId,
  eventId,
  maxPerAllocation = 100,
  onClose,
  onSuccess
}) => {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const sellerData = seller.seller || {};
  const collectionAlert = seller.collectionAlert || {};
  const sellerName = seller.basicInfo?.chineseName || seller.basicInfo?.englishName || 'N/A';

  // 统计数据
  const pointsStats = {
    personalBalance: seller.customer?.pointsAccount?.availablePoints || 0, // 消费余额
    totalRevenue: sellerData.totalRevenue || 0,
    totalCollected: sellerData.totalCashCollected || 0,
    pendingCollection: (sellerData.totalRevenue || 0) - (sellerData.totalCashCollected || 0),
    collectionRate: (sellerData.totalRevenue || 0) > 0
      ? (sellerData.totalCashCollected || 0) / (sellerData.totalRevenue || 0)
      : 0
  };

  // 快速金额选项
  const quickAmounts = [10, 20, 50, 100, 200, 500].filter(amt => amt <= maxPerAllocation);

  /**
   * 处理金额输入
   */
  const handleAmountChange = (value) => {
    const sanitized = value.replace(/[^\d.]/g, '');
    setAmount(sanitized);
    setError('');
  };

  /**
   * 快速选择金额
   */
  const handleQuickAmount = (value) => {
    setAmount(value.toString());
    setError('');
  };

  /**
   * 处理直接销售（通过 Cloud Function）
   */
  const handleDirectSale = async () => {
    // 验证输入
    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效的点数');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // 获取 Auth Token
      const user = auth.currentUser;
      if (!user) {
        throw new Error('未登录，请重新登录');
      }

      const token = await user.getIdToken();

      // 准备请求数据
      const requestBody = {
        organizationId: organizationId,
        eventId: eventId,
        recipientId: seller.id,
        points: parseFloat(amount),
        allocationType: 'personal',
        notes: notes || ''
      };

      console.log('[AllocatePoints] 开始直接销售', requestBody);

      // 调用 Cloud Function
      const response = await safeFetch('/api/allocatePointsBySellerManager', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      // 处理响应
      const result = await response.json();

      if (!response.ok) {
        const errorMessage = result.error?.message || '销售失败';
        throw new Error(errorMessage);
      }

      // 成功处理
      console.log('[AllocatePoints] ✅ 直接销售成功', result);

      setSuccessMessage(
        `成功销售 ${parseFloat(amount)} 点给 ${seller.basicInfo?.chineseName || seller.basicInfo?.englishName}！（收现金 RM ${parseFloat(amount)}）`
      );

      // 重置表单
      setAmount('');
      setNotes('');

      // 2秒后关闭弹窗
      setTimeout(() => {
        setSuccessMessage(null);
        onSuccess?.();
        onClose?.();
      }, 2000);

    } catch (err) {
      console.error('[AllocatePoints] 直接销售失败:', err);
      let errorMessage = '销售失败';

      if (err.message.includes('未登录')) {
        errorMessage = '登录已过期，请重新登录';
      } else if (err.message.includes('权限')) {
        errorMessage = '您没有权限执行此操作';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 验证并提交分配
   */
  const handleSubmit = async (e) => {
    e?.preventDefault?.();

    // 验证输入
    if (!seller || !seller.id) {
      setError('无效的 Seller 对象');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效的点数');
      return;
    }

    const pointsNumber = parseFloat(amount);
    if (isNaN(pointsNumber)) {
      setError('点数必须是数字');
      return;
    }

    if (pointsNumber > maxPerAllocation) {
      setError(`单次分配不能超过 ${maxPerAllocation}`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      console.log('[AllocatePoints] 开始销售点数', {
        recipientId: seller.id,
        recipientName: seller.basicInfo?.chineseName,
        points: pointsNumber
      });

      // 获取 Firebase Auth Token
      const user = auth.currentUser;
      if (!user) {
        throw new Error('未登录，请重新登录');
      }

      const token = await user.getIdToken();

      // 准备请求数据（固定使用 personal 类型）
      const requestBody = {
        organizationId: organizationId,
        eventId: eventId,
        recipientId: seller.id,
        points: pointsNumber,
        allocationType: 'personal', // 固定为 personal（收现金）
        notes: notes || ''
      };

      console.log('[AllocatePoints] 请求数据:', requestBody);

      // 调用 Cloud Function
      const response = await safeFetch('/api/allocatePointsBySellerManager', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      // 处理响应
      const result = await response.json();

      if (!response.ok) {
        const errorMessage = result.error?.message || '销售失败';
        throw new Error(errorMessage);
      }

      // 成功处理
      console.log('[AllocatePoints] ✅ 销售成功', result);

      setSuccessMessage(
        `成功销售 ${pointsNumber} 点给 ${seller.basicInfo?.chineseName || seller.basicInfo?.englishName}！（收现金 RM ${pointsNumber}）`
      );

      // 重置表单
      setAmount('');
      setNotes('');

      // 2秒后关闭弹窗
      setTimeout(() => {
        setSuccessMessage(null);
        onSuccess?.();
        onClose?.();
      }, 2000);

    } catch (err) {
      console.error('[AllocatePoints] ❌ 销售失败:', err);

      let errorMessage = '销售失败';

      if (err.message.includes('未登录')) {
        errorMessage = '登录已过期，请重新登录';
      } else if (err.message.includes('权限')) {
        errorMessage = '您没有权限执行此操作';
      } else if (err.message.includes('限额')) {
        errorMessage = err.message;
      } else if (err.message.includes('管理范围')) {
        errorMessage = '该用户不在您的管理范围内';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 计算预期余额
   */
  const getExpectedBalance = () => {
    const allocateAmount = parseFloat(amount);
    if (isNaN(allocateAmount)) return pointsStats.personalBalance;
    return pointsStats.personalBalance + allocateAmount;
  };

  /**
   * 获取警示级别颜色
   */
  const getWarningLevelColor = (level) => {
    switch (level) {
      case 'high': return '#dc2626';
      case 'medium': return '#f59e0b';
      case 'low': return '#fbbf24';
      default: return '#10b981';
    }
  };

  /**
   * 获取警示级别文字
   */
  const getWarningLevelText = (level) => {
    switch (level) {
      case 'high': return '高风险';
      case 'medium': return '中等风险';
      case 'low': return '低风险';
      default: return '无警示';
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* 标题 */}
        <div style={styles.header}>
          <h2 style={styles.title}>💰 销售点数</h2>
          <button style={styles.closeButton} onClick={onClose} disabled={loading}>
            ✕
          </button>
        </div>

        {/* Seller 信息 */}
        <div style={styles.sellerInfo}>
          <div style={styles.avatar}>
            {(sellerName[0] || '?').toUpperCase()}
          </div>
          <div style={styles.sellerDetails}>
            <div style={styles.sellerName}>{sellerName}</div>
            <div style={styles.sellerMeta}>
              <span style={styles.identityTag}>
                {getIdentityIcon(seller.identityTag)} {getIdentityText(seller.identityTag)}
              </span>
              <span style={styles.department}>
                🏫 {seller.identityInfo?.department || '未分配部门'}
              </span>
            </div>
          </div>
        </div>

        {/* 收款警示 */}
        {collectionAlert.hasWarning && (
          <div style={{
            ...styles.warningBanner,
            borderLeftColor: getWarningLevelColor(collectionAlert.warningLevel)
          }}>
            <div style={styles.warningIcon}>⚠️</div>
            <div style={styles.warningContent}>
              <div style={styles.warningTitle}>收款警示</div>
              <div style={styles.warningText}>
                待收款: RM {(collectionAlert.pendingAmount || 0).toLocaleString()}
                <span style={{
                  marginLeft: '0.5rem',
                  color: getWarningLevelColor(collectionAlert.warningLevel)
                }}>
                  ({getWarningLevelText(collectionAlert.warningLevel)})
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 当前统计 */}
        <div style={styles.statsBox}>
          <div style={styles.statsTitle}>当前余额</div>
          <div style={styles.statRow}>
            <span>💳 可用余额:</span>
            <strong style={{ fontSize: '1.125rem', color: '#1f2937' }}>
              {pointsStats.personalBalance.toLocaleString()} 点
            </strong>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statRow}>
            <span>累计销售:</span>
            <span>{pointsStats.totalRevenue.toLocaleString()}</span>
          </div>
          <div style={styles.statRow}>
            <span>收款率:</span>
            <span style={{
              color: pointsStats.collectionRate >= 0.8 ? '#10b981' :
                pointsStats.collectionRate >= 0.5 ? '#f59e0b' : '#ef4444',
              fontWeight: '600'
            }}>
              {Math.round(pointsStats.collectionRate * 100)}%
            </span>
          </div>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {/* 点数输入 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              销售点数 <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="输入点数"
              style={{
                ...styles.input,
                ...(error ? styles.inputError : {})
              }}
              disabled={loading}
            />
            <div style={styles.hint}>
              单次最多 {maxPerAllocation} 点
              <span style={{ marginLeft: '0.5rem', color: '#f59e0b', fontWeight: '600' }}>
                · 需收现金 RM {amount || 0}
              </span>
            </div>
          </div>

          {/* 快速金额 */}
          {quickAmounts.length > 0 && (
            <div style={styles.formGroup}>
              <label style={styles.label}>快速选择</label>
              <div style={styles.quickAmounts}>
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleQuickAmount(amt)}
                    style={{
                      ...styles.quickButton,
                      ...(amount === amt.toString() ? styles.quickButtonActive : {})
                    }}
                    disabled={loading}
                  >
                    {amt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 备注 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="添加备注信息..."
              rows={3}
              style={styles.textarea}
              disabled={loading}
            />
          </div>

          {/* 预览 */}
          {amount && parseFloat(amount) > 0 && (
            <div style={styles.preview}>
              <div style={styles.previewTitle}>📋 交易预览</div>
              <div style={styles.previewRow}>
                <span>接收者:</span>
                <span>{sellerName}</span>
              </div>
              <div style={styles.previewRow}>
                <span>销售点数:</span>
                <strong>{parseFloat(amount).toLocaleString()}</strong>
              </div>
              <div style={styles.previewRow}>
                <span>当前余额:</span>
                <span>{pointsStats.personalBalance.toLocaleString()}</span>
              </div>
              <div style={styles.previewDivider}></div>
              <div style={styles.previewRow}>
                <span>销售后余额:</span>
                <strong style={{ color: '#10b981', fontSize: '1.125rem' }}>
                  {getExpectedBalance().toLocaleString()}
                </strong>
              </div>
              <div style={{
                ...styles.previewRow,
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: '#fef3c7',
                borderRadius: '8px'
              }}>
                <span style={{ fontWeight: '600', color: '#92400e' }}>💵 收取现金:</span>
                <strong style={{ color: '#92400e', fontSize: '1.25rem' }}>
                  RM {parseFloat(amount).toLocaleString()}
                </strong>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          {/* 成功提示 */}
          {successMessage && (
            <div style={styles.successBox}>
              {successMessage}
            </div>
          )}

          {/* 按钮组 */}
          <div style={styles.buttonGroup}>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={onClose}
              disabled={loading}
            >
              取消
            </button>
            <button
              type="button"
              style={{
                ...styles.submitButton,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              onClick={handleDirectSale}
              disabled={loading}
            >
              {loading ? '处理中...' : '💰 直接销售（收现金）'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// === 辅助函数 ===
const getIdentityIcon = (tag) => {
  const icons = {
    student: '🎓',
    teacher: '👨‍🏫',
    staff: '👔',
    parent: '👨‍👩‍👧',
    volunteer: '🤝',
    external: '🌐'
  };
  return icons[tag] || '👤';
};

const getIdentityText = (tag) => {
  const texts = {
    student: '学生',
    teacher: '老师',
    staff: '职员',
    parent: '家长',
    volunteer: '义工',
    external: '外部'
  };
  return texts[tag] || '未知';
};

// === 样式 ===
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    background: 'white',
    borderRadius: '16px',
    padding: '2rem',
    maxWidth: '550px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0.25rem',
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    transition: 'all 0.2s'
  },
  sellerInfo: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '12px',
    marginBottom: '1.5rem'
  },
  avatar: {
    width: '60px',
    height: '60px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 'bold'
  },
  sellerDetails: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  sellerName: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  sellerMeta: {
    display: 'flex',
    gap: '0.75rem',
    fontSize: '0.875rem'
  },
  identityTag: {
    color: '#6b7280'
  },
  department: {
    color: '#6b7280'
  },
  warningBanner: {
    display: 'flex',
    gap: '0.75rem',
    padding: '1rem',
    background: '#fef3c7',
    borderLeft: '4px solid',
    borderRadius: '8px',
    marginBottom: '1.5rem'
  },
  warningIcon: {
    fontSize: '1.5rem'
  },
  warningContent: {
    flex: 1
  },
  warningTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#92400e',
    marginBottom: '0.25rem'
  },
  warningText: {
    fontSize: '0.875rem',
    color: '#92400e'
  },
  statsBox: {
    background: '#f9fafb',
    padding: '1rem',
    borderRadius: '12px',
    marginBottom: '1.5rem'
  },
  statsTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.75rem'
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
  },
  statDivider: {
    height: '1px',
    background: '#e5e7eb',
    margin: '0.5rem 0'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  input: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s'
  },
  inputError: {
    borderColor: '#ef4444'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  quickAmounts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
    gap: '0.5rem'
  },
  quickButton: {
    padding: '0.5rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  quickButtonActive: {
    borderColor: '#3b82f6',
    background: '#dbeafe',
    color: '#1e40af'
  },
  textarea: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit'
  },
  preview: {
    background: '#f0f9ff',
    border: '2px solid #bfdbfe',
    borderRadius: '12px',
    padding: '1rem'
  },
  previewTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#1e40af',
    marginBottom: '0.75rem'
  },
  previewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  previewDivider: {
    height: '1px',
    background: '#bfdbfe',
    margin: '0.5rem 0'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  successBox: {
    background: '#d1fae5',
    color: '#065f46',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #6ee7b7'
  },
  buttonGroup: {
    display: 'flex',
    gap: '1rem',
    marginTop: '0.5rem'
  },
  cancelButton: {
    flex: 1,
    padding: '0.75rem',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#374151',
    transition: 'all 0.2s'
  },
  submitButton: {
    flex: 2,
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: 'white',
    transition: 'all 0.2s'
  }
};

export default AllocatePoints;

import { useState } from 'react';
import { db } from '../../../config/firebase';
import { doc, collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Allocate Points Modal (重构版)
 * 
 * @description
 * Seller Manager 分配点数给 Seller 的弹窗组件
 * 
 * 新架构：
 * - 写入路径：Event/{eventId}/users/{sellerManagerId}/pointAllocations/{allocationId}
 * - Cloud Function 会自动处理统计更新
 * - 支持额度限制和收款警示
 * 
 * @param {Object} seller - 要分配点数的 Seller
 * @param {string} sellerManagerId - Seller Manager 的 userId
 * @param {string} eventId - 活动 ID
 * @param {number} maxPerAllocation - 每次分配上限
 * @param {number} warningThreshold - 收款警示阈值
 * @param {Function} onClose - 关闭回调
 */
const AllocatePoints = ({
  seller,
  sellerManagerId,
  eventId,
  maxPerAllocation,
  warningThreshold,
  onClose
}) => {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pointsStats = seller.pointsStats || {};
  const collectionAlert = seller.collectionAlert || {};
  const sellerName = seller.displayName || 'N/A';

  // 快速金额选择
  const quickAmounts = [50, 100, 200, 500];

  /**
   * 处理提交
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // 验证金额
    const allocateAmount = parseFloat(amount);
    if (isNaN(allocateAmount) || allocateAmount <= 0) {
      setError('请输入有效的金额');
      return;
    }

    // 验证是否超过上限
    if (allocateAmount > maxPerAllocation) {
      setError(`金额超过单次分配上限 (RM ${maxPerAllocation.toLocaleString()})`);
      return;
    }

    // 收款警示检查
    if (collectionAlert.hasWarning) {
      const confirmMsg = 
        `⚠️ 警告：该用户有待收款 RM ${(collectionAlert.pendingAmount || 0).toLocaleString()}\n\n` +
        `收款率: ${Math.round((pointsStats.collectionRate || 0) * 100)}%\n` +
        `建议先收款再分配新点数。\n\n` +
        `确定要继续分配 RM ${allocateAmount.toLocaleString()} 吗？`;
      
      if (!confirm(confirmMsg)) {
        return;
      }
    } else {
      // 正常确认
      if (!confirm(
        `确定要分配 RM ${allocateAmount.toLocaleString()} 给 ${sellerName} 吗？\n\n` +
        `对方当前余额: RM ${(pointsStats.currentBalance || 0).toLocaleString()}\n` +
        `分配后余额: RM ${((pointsStats.currentBalance || 0) + allocateAmount).toLocaleString()}`
      )) {
        return;
      }
    }

    setLoading(true);

    try {
      console.log('[AllocatePoints] 开始分配点数', {
        eventId,
        sellerManagerId,
        sellerId: seller.userId,
        amount: allocateAmount,
        notes
      });

      // 🔑 写入 Firestore
      // 路径：Event/{eventId}/users/{sellerManagerId}/pointAllocations/{allocationId}
      const allocationRef = collection(
        db,
        'Event',
        eventId,
        'users',
        sellerManagerId,
        'pointAllocations'
      );

      const allocationData = {
        recipientId: seller.userId,
        recipientName: sellerName,
        recipientDepartment: seller.department || '',
        points: allocateAmount,
        allocatedBy: sellerManagerId,
        allocatedByName: seller.displayName || 'Seller Manager', // 需要从当前用户获取
        allocatedByRole: 'sellerManager',
        allocatedAt: serverTimestamp(),
        status: 'completed', // 立即生效
        notes: notes || '',
        
        // 接收者统计快照
        recipientStatsSnapshot: {
          balanceAfter: (pointsStats.currentBalance || 0) + allocateAmount,
          pendingCollectionAfter: pointsStats.pendingCollection || 0
        }
      };

      const docRef = await addDoc(allocationRef, allocationData);

      console.log('[AllocatePoints] ✅ 分配记录创建成功:', docRef.id);

      // Cloud Function 会自动处理：
      // 1. 更新 Seller 的 pointsStats
      // 2. 更新部门的 departmentStats
      // 3. 更新 SellerManager 的 sellerManagerStats
      // 4. 更新 Event 的 globalPointsStats
      // 5. 检查收款警示

      // 成功提示
      alert(
        `✅ 分配成功！\n\n` +
        `Seller: ${sellerName}\n` +
        `金额: RM ${allocateAmount.toLocaleString()}\n` +
        `预计新余额: RM ${((pointsStats.currentBalance || 0) + allocateAmount).toLocaleString()}\n\n` +
        `统计数据将在几秒内自动更新`
      );

      // 关闭弹窗
      onClose();

    } catch (err) {
      console.error('[AllocatePoints] ❌ 分配失败:', err);
      setError(err.message || '分配点数失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 快速金额点击
   */
  const handleQuickAmount = (quickAmount) => {
    if (quickAmount <= maxPerAllocation) {
      setAmount(quickAmount.toString());
      setError('');
    } else {
      setError(`该金额超过单次分配上限 (RM ${maxPerAllocation.toLocaleString()})`);
    }
  };

  // identityTag 显示
  const getTagInfo = (tag) => {
    const tagMap = {
      student: { icon: '🎓', label: '学生' },
      teacher: { icon: '👨‍🏫', label: '老师' },
      staff: { icon: '👔', label: '职员' },
      parent: { icon: '👨‍👩‍👧', label: '家长' },
      volunteer: { icon: '🤝', label: '义工' },
      external: { icon: '🌐', label: '外部' }
    };
    return tagMap[tag] || { icon: '❓', label: '未知' };
  };

  const tagInfo = getTagInfo(seller.identityTag);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>💰 分配点数</h2>
          <button style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Seller Info */}
        <div style={styles.sellerInfo}>
          <div style={styles.sellerAvatar}>
            {sellerName[0].toUpperCase()}
          </div>
          <div style={styles.sellerDetails}>
            <div style={styles.sellerName}>{sellerName}</div>
            <div style={styles.sellerMeta}>
              <span style={styles.tagBadge}>
                {tagInfo.icon} {tagInfo.label}
              </span>
              <span style={styles.department}>
                📍 {seller.department || '无部门'}
              </span>
            </div>
          </div>
        </div>

        {/* 收款警示（如果有）*/}
        {collectionAlert.hasWarning && (
          <div style={styles.warningBanner}>
            <div style={styles.warningTitle}>⚠️ 收款警示</div>
            <div style={styles.warningContent}>
              待收款: RM {(collectionAlert.pendingAmount || 0).toLocaleString()}
              <br />
              收款率: {Math.round((pointsStats.collectionRate || 0) * 100)}%
              <br />
              <strong>建议先收款再分配新点数</strong>
            </div>
          </div>
        )}

        {/* Current Balance Info */}
        <div style={styles.balanceSection}>
          <div style={styles.balanceRow}>
            <span style={styles.balanceLabel}>当前持有点数:</span>
            <span style={styles.balanceValue}>
              RM {(pointsStats.currentBalance || 0).toLocaleString()}
            </span>
          </div>
          <div style={styles.balanceRow}>
            <span style={styles.balanceLabel}>累计销售额:</span>
            <span style={styles.balanceValue}>
              RM {(pointsStats.totalRevenue || 0).toLocaleString()}
            </span>
          </div>
          <div style={styles.balanceRow}>
            <span style={styles.balanceLabel}>收款率:</span>
            <span style={{
              ...styles.balanceValue,
              color: pointsStats.collectionRate >= 0.8 ? '#10b981' :
                     pointsStats.collectionRate >= 0.5 ? '#f59e0b' : '#ef4444'
            }}>
              {Math.round((pointsStats.collectionRate || 0) * 100)}%
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Amount Input */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              分配金额 (RM) * 
              <span style={styles.limitHint}>
                (上限: RM {maxPerAllocation.toLocaleString()})
              </span>
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              placeholder="输入金额"
              min="1"
              max={maxPerAllocation}
              step="1"
              required
              disabled={loading}
              style={styles.input}
            />
          </div>

          {/* Quick Amount Buttons */}
          <div style={styles.quickAmounts}>
            <label style={styles.quickLabel}>快速选择:</label>
            <div style={styles.quickButtonsRow}>
              {quickAmounts.map(qa => (
                <button
                  key={qa}
                  type="button"
                  onClick={() => handleQuickAmount(qa)}
                  disabled={loading || qa > maxPerAllocation}
                  style={{
                    ...styles.quickButton,
                    opacity: qa > maxPerAllocation ? 0.5 : 1,
                    cursor: qa > maxPerAllocation ? 'not-allowed' : 'pointer'
                  }}
                >
                  RM {qa.toLocaleString()}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleQuickAmount(maxPerAllocation)}
                disabled={loading}
                style={{
                  ...styles.quickButton,
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '2px solid #fbbf24'
                }}
              >
                上限 (RM {maxPerAllocation})
              </button>
            </div>
          </div>

          {/* Notes */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例如：月度销售奖励、活动启动资金"
              rows="3"
              disabled={loading}
              style={styles.textarea}
            />
          </div>

          {/* Calculation Preview */}
          {amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
            <div style={styles.previewBox}>
              <div style={styles.previewTitle}>📊 分配预览</div>
              <div style={styles.previewRow}>
                <span>分配金额:</span>
                <span style={styles.previewValue}>
                  RM {parseFloat(amount).toLocaleString()}
                </span>
              </div>
              <div style={styles.previewRow}>
                <span>Seller 新余额:</span>
                <span style={styles.previewValue}>
                  RM {((pointsStats.currentBalance || 0) + parseFloat(amount)).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          {/* Action Buttons */}
          <div style={styles.actions}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={styles.cancelButton}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxPerAllocation}
              style={{
                ...styles.submitButton,
                opacity: loading || !amount || parseFloat(amount) > maxPerAllocation ? 0.6 : 1,
                cursor: loading || !amount || parseFloat(amount) > maxPerAllocation ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? '分配中...' : '确认分配'}
            </button>
          </div>
        </form>

        {/* Help Text */}
        <div style={styles.helpText}>
          💡 提示：分配后 Cloud Functions 会自动更新所有统计数据
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    background: 'white',
    borderRadius: '16px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '2px solid #e5e7eb'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '0.25rem',
    lineHeight: 1
  },
  sellerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.5rem',
    background: '#fef3c7',
    borderBottom: '2px solid #fbbf24'
  },
  sellerAvatar: {
    width: '60px',
    height: '60px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 'bold'
  },
  sellerDetails: {
    flex: 1
  },
  sellerName: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.5rem'
  },
  sellerMeta: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center'
  },
  tagBadge: {
    padding: '0.25rem 0.5rem',
    background: '#92400e',
    color: 'white',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  department: {
    fontSize: '0.75rem',
    color: '#92400e'
  },
  warningBanner: {
    background: '#fee2e2',
    border: '2px solid #fecaca',
    padding: '1rem',
    borderBottom: '2px solid #fecaca'
  },
  warningTitle: {
    fontSize: '0.875rem',
    fontWeight: 'bold',
    color: '#991b1b',
    marginBottom: '0.5rem'
  },
  warningContent: {
    fontSize: '0.875rem',
    color: '#991b1b'
  },
  balanceSection: {
    padding: '1.5rem',
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb'
  },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem'
  },
  balanceLabel: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  balanceValue: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  form: {
    padding: '1.5rem'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  limitHint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    fontWeight: 'normal'
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box'
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  quickAmounts: {
    marginBottom: '1.5rem'
  },
  quickLabel: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: '0.75rem'
  },
  quickButtonsRow: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  quickButton: {
    padding: '0.5rem 1rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  previewBox: {
    background: '#f0fdf4',
    border: '2px solid #86efac',
    borderRadius: '8px',
    padding: '1rem',
    marginBottom: '1rem'
  },
  previewTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#166534',
    marginBottom: '0.75rem'
  },
  previewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#166534',
    marginBottom: '0.5rem'
  },
  previewValue: {
    fontWeight: '600',
    fontSize: '1rem'
  },
  errorBox: {
    background: '#fee2e2',
    border: '2px solid #fecaca',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    marginBottom: '1rem'
  },
  actions: {
    display: 'flex',
    gap: '1rem'
  },
  cancelButton: {
    flex: 1,
    padding: '0.75rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#6b7280',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  submitButton: {
    flex: 2,
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    color: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  helpText: {
    padding: '1rem 1.5rem 1.5rem',
    fontSize: '0.75rem',
    color: '#6b7280',
    textAlign: 'center'
  }
};

export default AllocatePoints;
import { useState } from 'react';

/**
 * Allocate Points Modal
 * 
 * @description
 * Seller Manager 分配固本给 Seller 的弹窗组件
 * 
 * @param {Object} seller - 要分配固本的 Seller
 * @param {Object} sellerManager - 当前 Seller Manager 信息
 * @param {number} availableCapital - SM 的可用资本
 * @param {string} organizationId - 组织 ID
 * @param {string} eventId - 活动 ID
 * @param {Function} onClose - 关闭回调
 * @param {Function} onSuccess - 成功后回调
 */
const AllocatePoints = ({
  seller,
  sellerManager,
  availableCapital,
  organizationId,
  eventId,
  onClose,
  onSuccess
}) => {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sellerData = seller.roleSpecificData?.seller || {};
  const sellerName = seller.basicInfo?.englishName || 'N/A';

  /**
   * 快速金额选择
   */
  const quickAmounts = [100, 500, 1000, 2000, 5000];

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

    if (allocateAmount > availableCapital) {
      setError(`金额超过您的可用资本 (RM ${availableCapital.toLocaleString()})`);
      return;
    }

    // 确认
    if (!confirm(
      `确定要分配 RM ${allocateAmount.toLocaleString()} 给 ${sellerName} 吗？\n\n` +
      `您的剩余可用资本将变为: RM ${(availableCapital - allocateAmount).toLocaleString()}`
    )) {
      return;
    }

    setLoading(true);

    try {
      console.log('[AllocatePoints] 开始分配固本', {
        seller: seller.id,
        amount: allocateAmount,
        notes
      });

      // 🔑 调用 Cloud Function
      const response = await fetch('/api/allocatePointsToSeller', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          sellerUserId: seller.id,
          amount: allocateAmount,
          operatorUid: sellerManager.userId,
          notes: notes || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || '分配固本失败');
      }

      console.log('[AllocatePoints] ✅ 分配成功', data);

      // 成功提示
      alert(
        `✅ 成功分配！\n\n` +
        `学生: ${sellerName}\n` +
        `金额: RM ${allocateAmount.toLocaleString()}\n` +
        `新余额: RM ${data.newSellerBalance?.toLocaleString() || 'N/A'}`
      );

      // 调用成功回调
      onSuccess();

    } catch (err) {
      console.error('[AllocatePoints] ❌ 分配失败:', err);
      setError(err.message || '分配固本失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 快速金额点击
   */
  const handleQuickAmount = (quickAmount) => {
    if (quickAmount <= availableCapital) {
      setAmount(quickAmount.toString());
    } else {
      setError(`金额超过您的可用资本 (RM ${availableCapital.toLocaleString()})`);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>💰 分配固本</h2>
          <button style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Seller Info */}
        <div style={styles.sellerInfo}>
          <div style={styles.sellerAvatar}>
            {sellerName[0].toUpperCase()}
          </div>
          <div>
            <div style={styles.sellerName}>{sellerName}</div>
            {seller.basicInfo?.chineseName && (
              <div style={styles.sellerChineseName}>
                {seller.basicInfo.chineseName}
              </div>
            )}
            <div style={styles.sellerClass}>
              {seller.basicInfo?.className || '未分配班级'}
            </div>
          </div>
        </div>

        {/* Current Balance Info */}
        <div style={styles.balanceSection}>
          <div style={styles.balanceRow}>
            <span style={styles.balanceLabel}>您的可用资本:</span>
            <span style={styles.balanceValue}>
              RM {availableCapital.toLocaleString()}
            </span>
          </div>
          <div style={styles.balanceRow}>
            <span style={styles.balanceLabel}>学生当前固本:</span>
            <span style={styles.balanceValue}>
              RM {(sellerData.availablePoints || 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Amount Input */}
          <div style={styles.formGroup}>
            <label style={styles.label}>分配金额 (RM) *</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              placeholder="输入金额"
              min="1"
              max={availableCapital}
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
                  disabled={loading || qa > availableCapital}
                  style={{
                    ...styles.quickButton,
                    opacity: qa > availableCapital ? 0.5 : 1,
                    cursor: qa > availableCapital ? 'not-allowed' : 'pointer'
                  }}
                >
                  RM {qa.toLocaleString()}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleQuickAmount(availableCapital)}
                disabled={loading || availableCapital <= 0}
                style={{
                  ...styles.quickButton,
                  background: '#fef3c7',
                  color: '#92400e',
                  border: '2px solid #fbbf24'
                }}
              >
                全部
              </button>
            </div>
          </div>

          {/* Notes */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例如：班级活动启动资金"
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
                <span>学生新余额:</span>
                <span style={styles.previewValue}>
                  RM {((sellerData.availablePoints || 0) + parseFloat(amount)).toLocaleString()}
                </span>
              </div>
              <div style={styles.previewDivider}></div>
              <div style={styles.previewRow}>
                <span>您的剩余资本:</span>
                <span style={{
                  ...styles.previewValue,
                  color: (availableCapital - parseFloat(amount)) < 100 ? '#dc2626' : '#10b981'
                }}>
                  RM {(availableCapital - parseFloat(amount)).toLocaleString()}
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
              disabled={loading || !amount || parseFloat(amount) <= 0}
              style={{
                ...styles.submitButton,
                opacity: loading || !amount ? 0.6 : 1,
                cursor: loading || !amount ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? '分配中...' : '确认分配'}
            </button>
          </div>
        </form>

        {/* Help Text */}
        <div style={styles.helpText}>
          💡 提示：分配后学生可以立即使用这些固本进行销售
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
  sellerName: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  sellerChineseName: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  sellerClass: {
    fontSize: '0.75rem',
    color: '#92400e',
    fontWeight: '500'
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
    fontSize: '1.125rem',
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
  previewDivider: {
    height: '1px',
    background: '#86efac',
    margin: '0.75rem 0'
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
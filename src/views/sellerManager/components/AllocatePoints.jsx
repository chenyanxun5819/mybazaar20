import { useState } from 'react';
import { db } from '../../../config/firebase';
import { doc, collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Allocate Points Modal (重构版 - 新架构适配)
 * 
 * @description
 * Seller Manager 分配点数给 Seller 的弹窗组件
 * 
 * ✅ 新架构路径（2025-11-28 更新）：
 * - organizations/{orgId}/events/{eventId}/users/{sellerManagerId}/pointAllocations/{allocationId}
 * - Cloud Function 会自动处理统计更新
 * - 支持额度限制和收款警示
 * 
 * @param {Object} seller - 要分配点数的 Seller
 * @param {Object} sellerManager - Seller Manager 用户信息
 * @param {string} organizationId - 组织 ID ✅ 新增
 * @param {string} eventId - 活动 ID
 * @param {number} maxPerAllocation - 每次分配上限
 * @param {Function} onClose - 关闭回调
 * @param {Function} onSuccess - 成功回调
 */
const AllocatePoints = ({
  seller,
  sellerManager,
  organizationId, // ✅ 新增参数
  eventId,
  maxPerAllocation = 100,
  onClose,
  onSuccess
}) => {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pointsStats = seller.pointsStats || {};
  const collectionAlert = seller.collectionAlert || {};
  const sellerName = seller.displayName || seller.chineseName || seller.englishName || 'N/A';
  const sellerManagerName = sellerManager.displayName || sellerManager.chineseName || sellerManager.englishName || 'Seller Manager';

  // 快速金额选择
  const quickAmounts = [50, 100, 200, 500, maxPerAllocation];

  /**
   * 处理金额输入
   */
  const handleAmountChange = (value) => {
    // 只允许数字和小数点
    const sanitized = value.replace(/[^\d.]/g, '');
    setAmount(sanitized);
    setError(''); // 清除错误提示
  };

  /**
   * 快速选择金额
   */
  const handleQuickAmount = (value) => {
    setAmount(value.toString());
    setError('');
  };

  /**
   * 验证并提交分配
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // ✅ 前端验证必需参数
    if (!organizationId || !eventId) {
      setError('缺少组织或活动信息，请重新登录');
      return;
    }

    // 验证金额
    const allocateAmount = parseFloat(amount);
    if (isNaN(allocateAmount) || allocateAmount <= 0) {
      setError('请输入有效的金额（大于 0）');
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
        `警示级别: ${collectionAlert.warningLevel || 'low'}\n\n` +
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
      console.log('[AllocatePoints] 开始分配点数');
      console.log('[AllocatePoints] organizationId:', organizationId);
      console.log('[AllocatePoints] eventId:', eventId);
      console.log('[AllocatePoints] sellerManagerId:', sellerManager.userId);
      console.log('[AllocatePoints] sellerId:', seller.userId);
      console.log('[AllocatePoints] amount:', allocateAmount);

      // 🔑 写入 Firestore（✅ 使用新架构路径）
      // 路径：organizations/{orgId}/events/{eventId}/users/{sellerManagerId}/pointAllocations/{allocationId}
      const allocationRef = collection(
        db,
        'organizations',
        organizationId,
        'events',
        eventId,
        'users',
        sellerManager.userId,
        'pointAllocations'
      );

      console.log('[AllocatePoints] 写入路径:', allocationRef.path);

      const allocationData = {
        // 接收者信息
        recipientId: seller.userId,
        recipientName: sellerName,
        recipientDepartment: seller.department || '',
        recipientIdentityTag: seller.identityTag || 'student',
        
        // 分配信息
        points: allocateAmount,
        allocatedBy: sellerManager.userId,
        allocatedByName: sellerManagerName,
        allocatedByRole: 'sellerManager',
        allocatedAt: serverTimestamp(),
        status: 'completed', // 立即生效
        notes: notes || '',
        
        // 接收者统计快照（用于审计和对账）
        recipientStatsSnapshot: {
          currentBalance: pointsStats.currentBalance || 0,
          balanceAfter: (pointsStats.currentBalance || 0) + allocateAmount,
          totalRevenue: pointsStats.totalRevenue || 0,
          totalCollected: pointsStats.totalCollected || 0,
          pendingCollection: pointsStats.pendingCollection || 0,
          collectionRate: pointsStats.collectionRate || 0,
          hasWarning: collectionAlert.hasWarning || false,
          warningLevel: collectionAlert.warningLevel || 'none'
        },

        // 元数据
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      console.log('[AllocatePoints] 分配数据:', allocationData);

      const docRef = await addDoc(allocationRef, allocationData);

      console.log('[AllocatePoints] ✅ 分配记录创建成功');
      console.log('[AllocatePoints] 文档 ID:', docRef.id);
      console.log('[AllocatePoints] 完整路径:', docRef.path);

      // Cloud Function（onSellerManagerAllocation）会自动处理：
      // 1. 更新 Seller 的 pointsStats.totalReceived
      // 2. 更新 Seller 的 pointsStats.receivedFromSellerManager
      // 3. 更新 Seller 的 pointsStats.currentBalance
      // 4. 更新部门的 departmentStats
      // 5. 更新 SellerManager 的 sellerManagerStats
      // 6. 更新 Event 的 globalPointsStats
      // 7. 检查收款警示

      // 成功提示
      alert(
        `✅ 分配成功！\n\n` +
        `Seller: ${sellerName}\n` +
        `金额: RM ${allocateAmount.toLocaleString()}\n` +
        `预计新余额: RM ${((pointsStats.currentBalance || 0) + allocateAmount).toLocaleString()}\n\n` +
        `统计数据将在几秒内自动更新`
      );

      // 调用成功回调
      if (onSuccess) {
        onSuccess();
      }

      // 关闭弹窗
      onClose();

    } catch (err) {
      console.error('[AllocatePoints] ❌ 分配失败:', err);
      console.error('[AllocatePoints] 错误详情:', err.message);
      
      setError(
        `分配失败: ${err.message}\n\n` +
        `请检查：\n` +
        `1. 您是否有权限管理该部门\n` +
        `2. 网络连接是否正常\n` +
        `3. Firestore 安全规则是否正确配置`
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * 计算预期余额
   */
  const getExpectedBalance = () => {
    const allocateAmount = parseFloat(amount);
    if (isNaN(allocateAmount)) return pointsStats.currentBalance || 0;
    return (pointsStats.currentBalance || 0) + allocateAmount;
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
          <h2 style={styles.title}>💰 分配点数</h2>
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
                🏫 {seller.department || '未分配部门'}
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
          <div style={styles.statRow}>
            <span>当前余额:</span>
            <strong>RM {(pointsStats.currentBalance || 0).toLocaleString()}</strong>
          </div>
          <div style={styles.statRow}>
            <span>累计销售:</span>
            <strong>RM {(pointsStats.totalRevenue || 0).toLocaleString()}</strong>
          </div>
          <div style={styles.statRow}>
            <span>收款率:</span>
            <strong style={{
              color: (pointsStats.collectionRate || 0) >= 0.8 ? '#10b981' : 
                     (pointsStats.collectionRate || 0) >= 0.5 ? '#f59e0b' : '#ef4444'
            }}>
              {Math.round((pointsStats.collectionRate || 0) * 100)}%
            </strong>
          </div>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {/* 金额输入 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>分配金额 (RM) *</label>
            <input
              type="text"
              style={{
                ...styles.input,
                ...(error ? styles.inputError : {})
              }}
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="请输入金额"
              disabled={loading}
              autoFocus
            />
            <div style={styles.hint}>
              单次分配上限: RM {maxPerAllocation.toLocaleString()}
            </div>
          </div>

          {/* 快速金额 */}
          <div style={styles.quickAmounts}>
            {quickAmounts.map(amt => (
              <button
                key={amt}
                type="button"
                style={{
                  ...styles.quickButton,
                  ...(parseInt(amount) === amt ? styles.quickButtonActive : {})
                }}
                onClick={() => handleQuickAmount(amt)}
                disabled={loading}
              >
                RM {amt}
              </button>
            ))}
          </div>

          {/* 备注 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              style={styles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="添加分配备注..."
              rows={3}
              disabled={loading}
            />
          </div>

          {/* 分配预览 */}
          {amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
            <div style={styles.preview}>
              <div style={styles.previewTitle}>📊 分配预览</div>
              <div style={styles.previewRow}>
                <span>分配金额:</span>
                <strong style={{ color: '#3b82f6' }}>
                  RM {parseFloat(amount).toLocaleString()}
                </strong>
              </div>
              <div style={styles.previewDivider}></div>
              <div style={styles.previewRow}>
                <span>预计新余额:</span>
                <strong style={{ color: '#10b981' }}>
                  RM {getExpectedBalance().toLocaleString()}
                </strong>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
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
              type="submit"
              style={{
                ...styles.submitButton,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              disabled={loading}
            >
              {loading ? '分配中...' : '确认分配'}
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
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
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
    border: '1px solid #fecaca',
    whiteSpace: 'pre-line'
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
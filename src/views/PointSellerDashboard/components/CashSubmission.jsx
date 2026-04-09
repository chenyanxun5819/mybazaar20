/**
 * Cash Submission Component - 修复版 v3.1
 * Tab 4: 现金上交 - 批量选择上交记录，提交到Cashier
 * 
 * 修复：
 * 1. 查询字段从 submitterId 改为 submittedBy
 * 2. 过滤逻辑改为检查 recordIds 数组
 * 3. 上交成功后刷新数据
 */

import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import TransactionPinDialog from '../common/TransactionPinDialog';
import './CashSubmission.css';

const CashSubmission = ({ 
  statistics, 
  records, 
  onRefresh, 
  currentUser, 
  userProfile,
  organizationId,
  eventId,
  callFunction 
}) => {
  const [selectedRecords, setSelectedRecords] = useState(new Set());
  const [submittedRecords, setSubmittedRecords] = useState([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // 交易密码对话框
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(null);

  // 格式化金额
  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return 'RM 0.00';
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 格式化日期时间
  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 监听已提交的现金记录
  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;
    const userId = userProfile?.userId;

    if (!orgId || !evtId || !userId) return;

    const submissionsRef = collection(db, 'organizations', orgId, 'events', evtId, 'cashSubmissions');
    const q = query(
      submissionsRef,
      where('submittedBy', '==', userId),  // ✅ 修正：使用 submittedBy
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log('[CashSubmission] 监听到提交记录:', submissions.length);
      setSubmittedRecords(submissions);
    }, (error) => {
      console.error('[CashSubmission] 监听现金提交记录失败:', error);
      
      // 如果是索引错误，提示用户
      if (error.message && error.message.includes('index')) {
        setError('Firestore 索引缺失，请联系管理员配置');
      }
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, organizationId, eventId]);

  // 监听所有销售记录（pointSellerSales 统一集合，含 card 和 cash 两种类型）
  const [localRecords, setLocalRecords] = useState([]);

  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;
    const userId = userProfile?.userId;

    if (!orgId || !evtId || !userId) return;

    const salesRef = collection(db, 'organizations', orgId, 'events', evtId, 'pointSellerSales');
    const qSales = query(
      salesRef,
      where('issuer.pointSellerId', '==', userId),
      orderBy('metadata.createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(qSales, (snapshot) => {
      const sales = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('[CashSubmission] 监听到销售记录:', sales.length);
      setLocalRecords(sales);
    }, (error) => {
      console.error('[CashSubmission] 监听销售记录失败:', error);

      if (error.message && error.message.includes('index')) {
        setError('Firestore 索引缺失，请联系管理员配置');
      }
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, organizationId, eventId]);

  // ✅ 使用本地监听的记录，如果没有则使用 props
  const effectiveRecords = localRecords.length > 0 ? localRecords : records;

  // ✅ 修正：可上交的记录（检查 recordIds 数组）
  const availableRecords = effectiveRecords.filter(record => {
    console.log(`\n[DEBUG] ========== 开始过滤记录 ${record.id} (${record.type}) ==========`);
    console.log(`[DEBUG] submittedRecords 数量: ${submittedRecords.length}`);
    
    // 检查是否已经在任何提交记录中
    const isSubmitted = submittedRecords.some(sub => {
      if (sub.recordIds && Array.isArray(sub.recordIds)) {
        return sub.recordIds.includes(record.id);
      }
      return false;
    });
    
    console.log(`[DEBUG] isSubmitted = ${isSubmitted}`);
    console.log(`[DEBUG] 返回 ${!isSubmitted} (${!isSubmitted ? '可上交' : '已上交'})`);
    console.log(`[DEBUG] ========== 结束 ==========\n`);
    
    if (!isSubmitted) {
      console.log(`[CashSubmission] 📝 记录 ${record.id} (${record.type}) 可上交`);
    }
    
    return !isSubmitted;
  });

  console.log(`[CashSubmission] 总记录: ${effectiveRecords.length}, 可上交: ${availableRecords.length}, 已提交: ${submittedRecords.length}, card: ${effectiveRecords.filter(r => r.saleType === 'card').length}, cash: ${effectiveRecords.filter(r => r.saleType === 'cash').length}`);

  // 已上交的记录
  const pendingSubmissions = submittedRecords.filter(sub => sub.status === 'pending');
  const confirmedSubmissions = submittedRecords.filter(sub => sub.status === 'confirmed');

  // 统计计算（cashReceived 字段在新架构中两种类型统一）
  // 1. 今日收现金（总额）- 从 effectiveRecords 实时计算
  const todayTotalCash = effectiveRecords.reduce((sum, record) => {
    return sum + (record.cashReceived || 0);
  }, 0);
  
  // 2. 上交待确认（pending 状态的总额）
  const pendingAmount = pendingSubmissions.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  
  // 3. 已上交（confirmed 状态的总额）
  const confirmedAmount = confirmedSubmissions.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  
  // 4. 未上交现金（可上交记录的总额）
  const unsubmittedAmount = availableRecords.reduce((sum, record) => {
    return sum + (record.cashReceived || 0);
  }, 0);

  // 计算选中金额
  const selectedAmount = Array.from(selectedRecords).reduce((sum, recordId) => {
    const record = availableRecords.find(r => r.id === recordId);
    if (!record) return sum;
    return sum + (record.cashReceived || 0);
  }, 0);

  // 处理选择/取消选择
  const handleToggleSelect = (recordId) => {
    setSelectedRecords(prev => {
      const newSet = new Set(prev);
      if (newSet.has(recordId)) {
        newSet.delete(recordId);
      } else {
        newSet.add(recordId);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const handleToggleSelectAll = () => {
    if (selectedRecords.size === availableRecords.length) {
      setSelectedRecords(new Set());
    } else {
      setSelectedRecords(new Set(availableRecords.map(r => r.id)));
    }
  };

  // 处理上交现金按钮点击
  const handleSubmitClick = () => {
    if (selectedRecords.size === 0) {
      setError('请至少选择一条记录');
      return;
    }

    // 显示交易密码对话框
    setPendingSubmission({
      recordIds: Array.from(selectedRecords),
      amount: selectedAmount,
      count: selectedRecords.size
    });
    setShowPinDialog(true);
    setError(null);
  };

  // 处理交易密码确认
  const handlePinConfirm = async (pin, confirmationNote) => {
    try {
      setLoading(true);
      setShowPinDialog(false);
      setError(null);
      setSuccessMessage(null);

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        throw new Error('无法获取活动信息');
      }

      // 准备上交数据
      const submissionData = {
        orgId,
        eventId: evtId,
        amount: pendingSubmission.amount,
        recordIds: pendingSubmission.recordIds,
        records: pendingSubmission.recordIds.map(id => {
          const record = availableRecords.find(r => r.id === id);
          return {
            id: record.id,
            saleType: record.saleType,
            amount: record.cashReceived || 0,
            saleNumber: record.saleNumber,
            customerName: record.cash?.customerName,
            timestamp: record.metadata?.createdAt
          };
        }),
        transactionPin: pin,
        note: confirmationNote || note || ''
      };

      console.log('[CashSubmission] 提交数据:', submissionData);

      // 调用Cloud Function提交现金
      const result = await callFunction(
        'submitCashAsPointSeller',
        submissionData,
        15000
      );

      if (result.data.success) {
        setSuccessMessage(
          `✅ 现金上交成功！金额: ${formatAmount(pendingSubmission.amount)}，共 ${pendingSubmission.count} 笔记录`
        );

        // 重置表单
        setSelectedRecords(new Set());
        setNote('');
        setPendingSubmission(null);

        // ✅ 刷新数据
        onRefresh();

        // 3秒后清除成功消息
        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      }
    } catch (err) {
      console.error('[CashSubmission] 上交现金失败:', err);
      setError('上交失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setPendingSubmission(null);
  };

  return (
    <div className="cash-submission">
      <h2 className="section-title">💰 现金上交</h2>

      {/* 统计卡片 - 3个（参考DirectSale的设计） */}
      <div className="inventory-summary">
        <div className="inventory-card">
          <div className="inventory-value">
            {formatAmount(todayTotalCash)}
          </div>
          <div className="inventory-label">今日收现金</div>
        </div>
        <div className="inventory-divider"></div>
        <div className="inventory-card">
          <div className="inventory-value">
            {formatAmount(pendingAmount)}
          </div>
          <div className="inventory-label">上交待确认</div>
        </div>
        <div className="inventory-divider"></div>
        <div className="inventory-card">
          <div className="inventory-value">
            {formatAmount(unsubmittedAmount)}
          </div>
          <div className="inventory-label">未上交现金</div>
        </div>
      </div>

      {/* 可上交记录 */}
      <div className="submission-section">
        <div className="section-header">
          <h3>📋 可上交记录</h3>
          <button className="select-all-btn" onClick={handleToggleSelectAll}>
            {selectedRecords.size === availableRecords.length && availableRecords.length > 0
              ? '取消全选'
              : '全选'}
          </button>
        </div>

        {availableRecords.length > 0 ? (
          <div style={styles.cardList}>
            {availableRecords.map(record => (
              <div
                key={record.id}
                style={styles.recordCard}
                onClick={() => handleToggleSelect(record.id)}
              >
                {/* 第一行：类型 + 金额 */}
                <div style={styles.recordCardFirstRow}>
                  <div style={styles.recordCardType}>
                    {record.saleType === 'card' ? '🎫 点数卡' : '🛒 直接销售'}
                  </div>
                  <div style={styles.recordCardQuantity}>
                    {formatAmount(record.cashReceived || 0)}
                  </div>
                </div>

                {/* 第二行：详情信息 */}
                <div style={styles.recordCardSecondRow}>
                  <div style={styles.recordCardLeftInfo}>
                    <div style={styles.recordCardName}>
                      {record.saleType === 'card'
                        ? `卡号: ${record.saleNumber}`
                        : `客户: ${record.cash?.customerName}`}
                    </div>
                    <div style={styles.recordCardCustomer}>
                      {formatDateTime(record.metadata?.createdAt)}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedRecords.has(record.id)}
                    onChange={() => {}}
                    style={{ cursor: 'pointer' }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="records-empty">
            <div className="empty-icon">✅</div>
            <p className="empty-message">所有记录已上交或暂无可上交记录</p>
          </div>
        )}

        {/* 选中金额和提交按钮 */}
        {selectedRecords.size > 0 && (
          <div className="selection-summary">
            <div className="summary-info">
              已选择 <strong>{selectedRecords.size}</strong> 笔记录，
              金额总计 <strong>{formatAmount(selectedAmount)}</strong>
            </div>

            <button
              onClick={handleSubmitClick}
              disabled={loading}
              className="submit-button"
            >
              {loading ? '提交中...' : `💰 上交 ${formatAmount(selectedAmount)}`}
            </button>
          </div>
        )}

        {/* 错误和成功消息 */}
        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {successMessage && (
          <div className="success-message">
            {successMessage}
          </div>
        )}
      </div>

      {/* 提交历史 */}
      {submittedRecords.length > 0 && (
        <div className="submission-history">
          <h3>📜 提交历史</h3>

          {/* 待确认 */}
          {pendingSubmissions.length > 0 && (
            <div className="history-section">
              <h4>⏳ 待确认 ({pendingSubmissions.length})</h4>
              {pendingSubmissions.map(sub => (
                <div key={sub.id} className="history-item pending">
                  <div className="history-header">
                    <span className="submission-number">{sub.submissionNumber || sub.submissionId}</span>
                    <span className="submission-amount">{formatAmount(sub.amount)}</span>
                  </div>
                  <div className="history-details">
                    <span>提交时间: {formatDateTime(sub.submittedAt)}</span>
                    <span className="status-badge pending">⏳ 待确认</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 已确认 */}
          {confirmedSubmissions.length > 0 && (
            <div className="history-section">
              <h4>✅ 已确认 ({confirmedSubmissions.length})</h4>
              {confirmedSubmissions.slice(0, 5).map(sub => (
                <div key={sub.id} className="history-item confirmed">
                  <div className="history-header">
                    <span className="submission-number">{sub.submissionNumber || sub.submissionId}</span>
                    <span className="submission-amount">{formatAmount(sub.amount)}</span>
                  </div>
                  <div className="history-details">
                    <span>确认时间: {formatDateTime(sub.confirmedAt)}</span>
                    <span className="status-badge confirmed">✅ 已确认</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 交易密码对话框 */}
      {showPinDialog && pendingSubmission && (
        <TransactionPinDialog
          title="确认上交现金"
          message={`即将上交 ${formatAmount(pendingSubmission.amount)}（${pendingSubmission.count} 笔记录）给 Cashier`}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          confirmButtonText="✅ 确认上交"
          allowNote={true}
          noteLabel="备注（可选）"
          notePlaceholder="请输入备注信息..."
        />
      )}
    </div>
  );
};

// ===== 内联样式定义 =====
const styles = {
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0'
  },
  recordCard: {
    background: 'transparent',
    padding: '0.5rem 0.75rem',
    marginBottom: '0.25rem',
    borderBottom: '1px solid #e5e7eb'
  },
  recordCardFirstRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '0.5rem'
  },
  recordCardDate: {
    fontSize: '0.8rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  recordCardType: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  recordCardSecondRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem'
  },
  recordCardLeftInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem'
  },
  recordCardName: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  recordCardCustomer: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  recordCardQuantity: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#3b82f6',
    whiteSpace: 'nowrap'
  }
};

export default CashSubmission;

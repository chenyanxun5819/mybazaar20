/**
 * Cash Submission Component - 修复版 v3.1
 * Tab 4: 现金上交 - 批量选择上交记录，提交到Finance Manager
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

  // ✅ 修正：可上交的记录（检查 recordIds 数组）
  const availableRecords = records.filter(record => {
    // 检查是否已经在任何提交记录中
    const isSubmitted = submittedRecords.some(sub => {
      // 主要方法：检查 recordIds 数组
      if (sub.recordIds && Array.isArray(sub.recordIds)) {
        const found = sub.recordIds.includes(record.id);
        if (found) {
          console.log(`[CashSubmission] 记录 ${record.id} 在提交 ${sub.submissionId} 的 recordIds 中`);
        }
        return found;
      }
      
      // 兼容方法1：检查 pointCardInfo.cardIds（点数卡）
      if (record.type === 'point_card' && sub.pointCardInfo?.cardIds) {
        const cardId = record.id || record.cardId;
        const found = sub.pointCardInfo.cardIds.includes(cardId);
        if (found) {
          console.log(`[CashSubmission] 点数卡 ${cardId} 在提交 ${sub.submissionId} 的 cardIds 中`);
        }
        return found;
      }
      
      // 兼容方法2：检查 includedSales（直接销售）
      if (record.type === 'direct_sale' && sub.includedSales) {
        const transactionId = record.id || record.transactionId;
        const found = sub.includedSales.some(sale => 
          sale.transactionIds && sale.transactionIds.includes(transactionId)
        );
        if (found) {
          console.log(`[CashSubmission] 直接销售 ${transactionId} 在提交 ${sub.submissionId} 的 includedSales 中`);
        }
        return found;
      }
      
      return false;
    });
    
    if (!isSubmitted) {
      console.log(`[CashSubmission] 记录 ${record.id} (${record.type}) 可上交`);
    }
    
    return !isSubmitted;
  });

  console.log(`[CashSubmission] 总记录: ${records.length}, 可上交: ${availableRecords.length}, 已提交: ${submittedRecords.length}`);

  // 已上交的记录
  const pendingSubmissions = submittedRecords.filter(sub => sub.status === 'pending');
  const confirmedSubmissions = submittedRecords.filter(sub => sub.status === 'confirmed');

  // ✅ 重新设计统计计算
  // 1. 今日收现金（总额）
  const todayTotalCash = statistics.todayStats?.totalCashReceived || 
                         statistics.cashManagement?.cashOnHand || 0;
  
  // 2. 上交待确认（pending 状态的总额）
  const pendingAmount = pendingSubmissions.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  
  // 3. 已上交（confirmed 状态的总额）
  const confirmedAmount = confirmedSubmissions.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  
  // 4. 未上交现金（计算值）
  const unsubmittedAmount = todayTotalCash - pendingAmount - confirmedAmount;

  // 计算选中金额
  const selectedAmount = Array.from(selectedRecords).reduce((sum, recordId) => {
    const record = availableRecords.find(r => r.id === recordId);
    if (!record) return sum;
    
    if (record.type === 'point_card') {
      return sum + (record.issuer?.cashReceived || 0);
    } else {
      return sum + (record.amount || 0);
    }
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
            type: record.type,
            amount: record.type === 'point_card' 
              ? (record.issuer?.cashReceived || 0)
              : (record.amount || 0),
            cardNumber: record.cardNumber,
            customerName: record.customerName,
            // ✅ 新增：添加更多信息用于后端处理
            cardId: record.cardId,
            transactionId: record.transactionId,
            timestamp: record.metadata?.createdAt || record.timestamp
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

      {/* 统计卡片 - 4个 */}
      <div className="stats-row">
        <div className="stat-card blue">
          <div className="stat-label">今日收现金</div>
          <div className="stat-value">{formatAmount(todayTotalCash)}</div>
          <div className="stat-hint">现金总额</div>
        </div>

        <div className="stat-card orange">
          <div className="stat-label">上交待确认</div>
          <div className="stat-value">{formatAmount(pendingAmount)}</div>
          <div className="stat-hint">{pendingSubmissions.length} 笔待确认</div>
        </div>

        <div className="stat-card green">
          <div className="stat-label">已上交</div>
          <div className="stat-value">{formatAmount(confirmedAmount)}</div>
          <div className="stat-hint">{confirmedSubmissions.length} 笔已确认</div>
        </div>

        <div className="stat-card purple">
          <div className="stat-label">未上交现金</div>
          <div className="stat-value">{formatAmount(unsubmittedAmount)}</div>
          <div className="stat-hint">可上交金额</div>
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
          <div className="records-list">
            {availableRecords.map(record => (
              <div
                key={record.id}
                className={`record-item ${selectedRecords.has(record.id) ? 'selected' : ''}`}
                onClick={() => handleToggleSelect(record.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedRecords.has(record.id)}
                  onChange={() => {}}
                  className="record-checkbox"
                />

                <div className="record-content">
                  <div className="record-header">
                    <span className={`record-type ${record.type}`}>
                      {record.type === 'point_card' ? '🎫 点数卡' : '🛒 直接销售'}
                    </span>
                    <span className="record-amount">
                      {record.type === 'point_card'
                        ? formatAmount(record.issuer?.cashReceived || 0)
                        : formatAmount(record.amount || 0)}
                    </span>
                  </div>

                  <div className="record-details">
                    {record.type === 'point_card' ? (
                      <>
                        <div className="detail-item">
                          <span className="detail-label">卡号:</span>
                          <span className="detail-value">{record.cardNumber}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">时间:</span>
                          <span className="detail-value">
                            {formatDateTime(record.metadata?.createdAt)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="detail-item">
                          <span className="detail-label">客户:</span>
                          <span className="detail-value">{record.customerName}</span>
                        </div>
                        <div className="detail-item">
                          <span className="detail-label">时间:</span>
                          <span className="detail-value">
                            {formatDateTime(record.timestamp)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
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
          message={`即将上交 ${formatAmount(pendingSubmission.amount)}（${pendingSubmission.count} 笔记录）给 Finance Manager`}
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

export default CashSubmission;
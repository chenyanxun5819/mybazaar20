/**
 * Cash Submission Component
 * Tab 4: 现金上交 - 批量选择上交记录，提交到Finance Manager
 */

import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
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
      where('submitterId', '==', userId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSubmittedRecords(submissions);
    }, (error) => {
      console.error('监听现金提交记录失败:', error);
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, organizationId, eventId]);

  // 可上交的记录（只包含还未上交的）
  const availableRecords = records.filter(record => {
    // 检查是否已经上交
    const isSubmitted = submittedRecords.some(sub => 
      (record.type === 'point_card' && sub.sourceType === 'point_card' && sub.sourceId === record.id) ||
      (record.type === 'direct_sale' && sub.sourceType === 'direct_sale' && sub.sourceId === record.id)
    );
    return !isSubmitted;
  });

  // 已上交的记录
  const pendingSubmissions = submittedRecords.filter(sub => sub.status === 'pending');
  const confirmedSubmissions = submittedRecords.filter(sub => sub.status === 'confirmed');

  // 计算统计
  const totalCashReceived = statistics.todayStats?.totalCashReceived || 0;
  const totalSubmitted = submittedRecords.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  const pendingAmount = totalCashReceived - totalSubmitted;

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
            customerName: record.customerName
          };
        }),
        transactionPin: pin,
        note: confirmationNote || note || ''
      };

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

        // 刷新统计
        onRefresh();
      }
    } catch (err) {
      console.error('上交现金失败:', err);
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

      {/* 现金统计 */}
      <div className="cash-summary">
        <div className="summary-card total">
          <div className="summary-label">今日收现金</div>
          <div className="summary-value">{formatAmount(totalCashReceived)}</div>
        </div>
        <div className="summary-card submitted">
          <div className="summary-label">已上交</div>
          <div className="summary-value">{formatAmount(totalSubmitted)}</div>
        </div>
        <div className="summary-card pending">
          <div className="summary-label">待上交</div>
          <div className="summary-value highlight">{formatAmount(pendingAmount)}</div>
        </div>
      </div>

      {/* 可上交记录 */}
      <div className="available-section">
        <div className="section-header">
          <h3>📋 可上交记录</h3>
          {availableRecords.length > 0 && (
            <button 
              className="select-all-btn"
              onClick={handleToggleSelectAll}
            >
              {selectedRecords.size === availableRecords.length ? '取消全选' : '全选'}
            </button>
          )}
        </div>

        {availableRecords.length > 0 ? (
          <div className="records-list">
            {availableRecords.map(record => {
              const isSelected = selectedRecords.has(record.id);
              const recordAmount = record.type === 'point_card'
                ? (record.issuer?.cashReceived || 0)
                : (record.amount || 0);

              return (
                <div 
                  key={record.id} 
                  className={`record-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleToggleSelect(record.id)}
                >
                  <div className="record-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(record.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="record-info">
                    <div className="record-type">
                      {record.type === 'point_card' ? '🎫 点数卡' : '🛒 直接销售'}
                    </div>
                    <div className="record-details">
                      {record.type === 'point_card' ? (
                        <span>卡号: {record.cardNumber}</span>
                      ) : (
                        <span>客户: {record.customerName}</span>
                      )}
                    </div>
                    <div className="record-time">
                      {formatDateTime(
                        record.type === 'point_card'
                          ? record.metadata?.createdAt
                          : record.timestamp
                      )}
                    </div>
                  </div>
                  <div className="record-amount">
                    {formatAmount(recordAmount)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="records-empty">
            <div className="empty-icon">✅</div>
            <p className="empty-message">没有待上交的记录</p>
          </div>
        )}

        {/* 选中统计和提交 */}
        {selectedRecords.size > 0 && (
          <div className="submission-panel">
            <div className="selected-summary">
              <span className="selected-count">已选择 {selectedRecords.size} 笔</span>
              <span className="selected-amount">{formatAmount(selectedAmount)}</span>
            </div>

            <div className="note-group">
              <label htmlFor="submissionNote">备注（可选）</label>
              <textarea
                id="submissionNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：第一批上交，包含10张点数卡和5笔直接销售"
                maxLength={200}
                rows={2}
              />
              <div className="char-count">{note.length} / 200</div>
            </div>

            <button
              className="submit-cash-btn"
              onClick={handleSubmitClick}
              disabled={loading}
            >
              {loading ? '提交中...' : `💰 上交现金 ${formatAmount(selectedAmount)}`}
            </button>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {/* 成功提示 */}
      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}

      {/* 待确认记录 */}
      {pendingSubmissions.length > 0 && (
        <div className="pending-section">
          <h3>⏳ 待Finance Manager确认</h3>
          <div className="pending-list">
            {pendingSubmissions.map(sub => (
              <div key={sub.id} className="pending-item">
                <div className="pending-info">
                  <div className="pending-amount">{formatAmount(sub.amount)}</div>
                  <div className="pending-time">{formatDateTime(sub.submittedAt)}</div>
                  {sub.note && <div className="pending-note">{sub.note}</div>}
                </div>
                <div className="pending-status">
                  <span className="status-badge pending">⏳ 待确认</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 已确认记录 */}
      {confirmedSubmissions.length > 0 && (
        <div className="confirmed-section">
          <h3>✅ 已确认记录</h3>
          <div className="confirmed-list">
            {confirmedSubmissions.slice(0, 5).map(sub => (
              <div key={sub.id} className="confirmed-item">
                <div className="confirmed-info">
                  <div className="confirmed-amount">{formatAmount(sub.amount)}</div>
                  <div className="confirmed-time">
                    提交: {formatDateTime(sub.submittedAt)}
                  </div>
                  <div className="confirmed-receiver">
                    确认人: {sub.receiverName}
                  </div>
                </div>
                <div className="confirmed-status">
                  <span className="status-badge confirmed">✓ 已确认</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 交易密码对话框 */}
      {showPinDialog && pendingSubmission && (
        <TransactionPinDialog
          title="确认上交现金"
          message={`即将上交 ${pendingSubmission.count} 笔记录，总金额 ${formatAmount(pendingSubmission.amount)}`}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          confirmButtonText="✅ 确认上交"
          allowNote={true}
        />
      )}
    </div>
  );
};

export default CashSubmission;
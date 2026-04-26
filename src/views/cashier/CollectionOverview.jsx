/**
 * Collection Overview Component
 * Tab 1: 收款概览 - 显示统计卡片、待确认收款和待认领池子
 */

import React, { useState } from 'react';
import TransactionPinDialog from '@components/common/TransactionPinDialog';
import './CollectionOverview.css';

const CollectionOverview = ({ statistics, pendingSubmissions, onRefresh, onClaim, currentUser }) => {
  const { cashStats, pendingStats } = statistics;
  const [claimingId, setClaimingId] = useState(null);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState(null);

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
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 格式化完整日期时间
  const formatFullDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 角色翻译
  const getRoleLabel = (role) => {
    const roleMap = {
      teamLeader: 'Team Leader',
      pointSeller: 'Point Seller'
    };
    return roleMap[role] || role;
  };

  // 获取角色图标
  const getRoleIcon = (role) => {
    const iconMap = {
      teamLeader: '👨‍🏫',
      pointSeller: '💳'
    };
    return iconMap[role] || '👤';
  };

  // 处理接单确认按钮点击
  const handleClaimClick = (submission) => {
    setSelectedSubmission(submission);
    setShowPinDialog(true);
  };

  // 处理交易密码确认
  const handlePinConfirm = async (pin, confirmationNote) => {
    if (!selectedSubmission) return;

    try {
      setClaimingId(selectedSubmission.id);
      setShowPinDialog(false);

      await onClaim(selectedSubmission.id, pin, confirmationNote);

      window.mybazaarShowToast('✅ 收款确认成功！');
      setSelectedSubmission(null);
      onRefresh();
    } catch (error) {
      console.error('接单确认失败:', error);
      window.mybazaarShowToast('❌ 确认失败: ' + error.message);
    } finally {
      setClaimingId(null);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setSelectedSubmission(null);
  };

  // 统计卡片数据
  const statsCards = [
    {
      title: '今日收款',
      icon: '💰',
      amount: cashStats.todayCollected || 0,
      count: cashStats.todayCollections || 0,
      color: 'blue'
    },
    {
      title: '本周收款',
      icon: '📅',
      amount: cashStats.thisWeekCollected || 0,
      count: cashStats.thisWeekCollections || 0,
      color: 'green'
    },
    {
      title: '本月收款',
      icon: '📆',
      amount: cashStats.thisMonthCollected || 0,
      count: cashStats.thisMonthCollections || 0,
      color: 'purple'
    },
    {
      title: '累计收款',
      icon: '📊',
      amount: cashStats.totalCollected || 0,
      count: cashStats.totalCollections || 0,
      color: 'orange'
    }
  ];

  return (
    <div className="collection-overview">
      {/* 刷新按钮 */}
      <div className="overview-header">
        <h2>📊 收款概览</h2>
        <button className="refresh-button" onClick={onRefresh}>
          🔄 刷新数据
        </button>
      </div>

      {/* 统计卡片 - 单行显示 */}
      <div className="stats-cards">
        {statsCards.map((card, index) => (
          <div key={index} className={`stat-card ${card.color}`}>
            <div className="card-header">
              <span className="card-icon">{card.icon}</span>
              <span className="card-title">{card.title}</span>
            </div>
            <div className="card-content">
              <div className="amount">{formatAmount(card.amount)}</div>
              <div className="count">{card.count} 笔</div>
            </div>
          </div>
        ))}
      </div>

      {/* 待确认统计 */}
      <div className="pending-summary">
        <h3>⏳ 待确认收款</h3>
        <div className="pending-cards">
          <div className="pending-card">
            <div className="pending-label">待确认金额</div>
            <div className="pending-amount">
              {formatAmount(pendingStats.pendingAmount || 0)}
            </div>
          </div>
          <div className="pending-card">
            <div className="pending-label">待确认笔数</div>
            <div className="pending-count">
              {pendingStats.pendingCount || 0} 笔
            </div>
          </div>
          {pendingStats.oldestPendingDate && (
            <div className="pending-card">
              <div className="pending-label">最早待确认</div>
              <div className="pending-date">
                {formatDateTime(pendingStats.oldestPendingDate)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 待认领收款池 */}
      <div className="pending-pool-section">
        <div className="pool-header">
          <h3>💰 待认领收款池</h3>
          <span className="pool-count">
            {pendingSubmissions?.length || 0} 笔待认领
          </span>
        </div>

        {pendingSubmissions && pendingSubmissions.length > 0 ? (
          <div className="pool-table-container">
            <table className="pool-table">
              <thead>
                <tr>
                  <th>提交者</th>
                  <th>金额</th>
                  <th>提交时间</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pendingSubmissions.map(submission => (
                  <tr key={submission.id}>
                    <td>
                      <div className="submitter-cell">
                        <span className="role-icon">{getRoleIcon(submission.submitterRole)}</span>
                        <div className="submitter-info">
                          <div className="submitter-name">{submission.submitterName}</div>
                          <div className="submitter-meta">
                            <span className="role-badge">{getRoleLabel(submission.submitterRole)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="amount-cell">{formatAmount(submission.amount)}</div>
                    </td>
                    <td>
                      <div className="time-cell">{formatFullDateTime(submission.submittedAt)}</div>
                    </td>
                    <td>
                      <div className={`note-cell ${!submission.note ? 'empty' : ''}`}>
                        {submission.note || '-'}
                      </div>
                    </td>
                    <td className="action-cell">
                      <button
                        className="claim-button"
                        onClick={() => handleClaimClick(submission)}
                        disabled={claimingId === submission.id}
                      >
                        {claimingId === submission.id ? '⏳ 处理中...' : '🎯 接单确认'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pool-empty">
            <div className="empty-icon">✅</div>
            <p className="empty-message">太棒了！待认领池子是空的</p>
            <p className="empty-hint">所有现金上交都已处理完毕</p>
          </div>
        )}
      </div>

      {/* 最后收款信息 */}
      {cashStats.lastCollectionAt && (
        <div className="last-collection">
          <h3>🕐 最后收款时间</h3>
          <p className="last-collection-time">
            {formatDateTime(cashStats.lastCollectionAt)}
          </p>
        </div>
      )}

      {/* 交易密码对话框 */}
      {showPinDialog && selectedSubmission && (
        <TransactionPinDialog
          title="🔐 接单确认收款"
          submission={selectedSubmission}
          requireReceiptNumber={true}
          receiptNumberLabel="收据编号"
          receiptNumberPlaceholder="例如：RCP-2025-001"
          allowNote={true}
          noteLabel="确认备注（可选）"
          notePlaceholder="例如：已核对无误，收到50张100元纸钞"
          confirmButtonText="✅ 确认收款"
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
        />
      )}
    </div>
  );
};

export default CollectionOverview;

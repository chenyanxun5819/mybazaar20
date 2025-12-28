/**
 * Collection Overview Component
 * Tab 1: 收款概览 - 显示统计卡片和收款数据
 */

import React from 'react';
import './CollectionOverview.css';

const CollectionOverview = ({ statistics, onRefresh }) => {
  const { cashStats, pendingStats } = statistics;

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

      {/* 统计卡片 */}
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

      {/* 最后收款信息 */}
      {cashStats.lastCollectionAt && (
        <div className="last-collection">
          <h3>🕐 最后收款时间</h3>
          <p className="last-collection-time">
            {formatDateTime(cashStats.lastCollectionAt)}
          </p>
        </div>
      )}

      {/* 收款提示 */}
      {pendingStats.pendingCount > 0 && (
        <div className="collection-alert">
          <div className="alert-icon">⚠️</div>
          <div className="alert-message">
            <strong>您有 {pendingStats.pendingCount} 笔待确认收款</strong>
            <p>请前往"待确认"标签页进行处理</p>
          </div>
        </div>
      )}

      {/* 无数据提示 */}
      {cashStats.totalCollections === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <p className="empty-message">暂无收款记录</p>
          <p className="empty-hint">当有人提交现金上交后，这里会显示统计数据</p>
        </div>
      )}
    </div>
  );
};

export default CollectionOverview;
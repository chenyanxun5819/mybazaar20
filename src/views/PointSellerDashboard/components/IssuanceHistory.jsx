/**
 * Issuance History Component
 * Tab 3: 发行记录 - 统计卡片 + 历史记录列表
 */

import React, { useState } from 'react';
import './IssuanceHistory.css';

const IssuanceHistory = ({ statistics, records, onRefresh }) => {
  const [filter, setFilter] = useState('all'); // all | point_card | direct_sale
  const [searchTerm, setSearchTerm] = useState('');

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

  // 过滤记录
  const filteredRecords = records.filter(record => {
    // 类型过滤
    if (filter !== 'all' && record.type !== filter) {
      return false;
    }

    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const cardNumber = record.cardNumber?.toLowerCase() || '';
      const customerName = record.customerName?.toLowerCase() || '';
      const transactionId = record.transactionId?.toLowerCase() || '';
      
      return cardNumber.includes(term) || 
             customerName.includes(term) || 
             transactionId.includes(term);
    }

    return true;
  });

  // 统计卡片数据
  const statsCards = [
    {
      title: '今日发行卡数',
      icon: '🎫',
      value: statistics.todayStats?.cardsIssued || 0,
      unit: '张',
      color: 'blue'
    },
    {
      title: '今日发行点数',
      icon: '💎',
      value: statistics.todayStats?.totalPointsIssued || 0,
      unit: '点',
      color: 'green'
    },
    {
      title: '今日收现金',
      icon: '💰',
      value: formatAmount(statistics.todayStats?.totalCashReceived || 0),
      unit: '',
      color: 'purple'
    },
    {
      title: '直接销售笔数',
      icon: '🛒',
      value: statistics.todayStats?.directSalesCount || 0,
      unit: '笔',
      color: 'orange'
    }
  ];

  return (
    <div className="issuance-history">
      {/* 刷新按钮 */}
      <div className="history-header">
        <h2>📊 发行记录</h2>
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
              <div className="value">{card.value}</div>
              {card.unit && <div className="unit">{card.unit}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* 累计统计 */}
      <div className="total-stats">
        <h3>📈 累计统计</h3>
        <div className="total-cards">
          <div className="total-card">
            <div className="total-label">累计发行卡数</div>
            <div className="total-value">
              {statistics.totalStats?.totalCardsIssued || 0} 张
            </div>
          </div>
          <div className="total-card">
            <div className="total-label">累计发行点数</div>
            <div className="total-value">
              {statistics.totalStats?.totalPointsIssued || 0} 点
            </div>
          </div>
          <div className="total-card">
            <div className="total-label">累计收现金</div>
            <div className="total-value">
              {formatAmount(statistics.totalStats?.totalCashReceived || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* 筛选和搜索 */}
      <div className="filter-section">
        <div className="filter-buttons">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部记录
          </button>
          <button
            className={`filter-btn ${filter === 'point_card' ? 'active' : ''}`}
            onClick={() => setFilter('point_card')}
          >
            🎫 点数卡
          </button>
          <button
            className={`filter-btn ${filter === 'direct_sale' ? 'active' : ''}`}
            onClick={() => setFilter('direct_sale')}
          >
            🛒 直接销售
          </button>
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder="搜索卡号、客户名称..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* 记录列表 */}
      <div className="records-section">
        <h3>📝 发行记录明细</h3>
        
        {filteredRecords.length > 0 ? (
          <div className="records-table-container">
            <table className="records-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>编号/客户</th>
                  <th>点数</th>
                  <th>现金</th>
                  <th>时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map(record => (
                  <tr key={record.id}>
                    <td>
                      <span className={`record-type ${record.type}`}>
                        {record.type === 'point_card' ? '🎫 点数卡' : '🛒 直接销售'}
                      </span>
                    </td>
                    <td>
                      {record.type === 'point_card' ? (
                        <div className="card-info">
                          <div className="card-number">{record.cardNumber}</div>
                          <div className="card-id">{record.cardId}</div>
                        </div>
                      ) : (
                        <div className="customer-info">
                          <div className="customer-name">{record.customerName}</div>
                          <div className="customer-id">{record.customerId}</div>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="points-cell">
                        {record.type === 'point_card' 
                          ? (record.balance?.initial || 0)
                          : (record.points || record.amount || 0)
                        } 点
                      </div>
                    </td>
                    <td>
                      <div className="amount-cell">
                        {record.type === 'point_card'
                          ? formatAmount(record.issuer?.cashReceived || 0)
                          : formatAmount(record.amount || 0)
                        }
                      </div>
                    </td>
                    <td>
                      <div className="time-cell">
                        {formatDateTime(
                          record.type === 'point_card'
                            ? record.metadata?.createdAt
                            : record.timestamp
                        )}
                      </div>
                    </td>
                    <td>
                      {record.type === 'point_card' ? (
                        <span className={`status-badge ${record.status?.isActive ? 'active' : 'inactive'}`}>
                          {record.status?.isActive ? '✓ 有效' : '✗ 已失效'}
                        </span>
                      ) : (
                        <span className={`status-badge ${record.status === 'completed' ? 'completed' : 'pending'}`}>
                          {record.status === 'completed' ? '✓ 完成' : '⏳ 处理中'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="records-empty">
            <div className="empty-icon">📋</div>
            <p className="empty-message">
              {searchTerm || filter !== 'all' 
                ? '没有符合条件的记录'
                : '还没有发行记录'
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default IssuanceHistory;

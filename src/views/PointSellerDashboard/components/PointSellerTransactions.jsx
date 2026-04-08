/**
 * Issuance History Component
 * Tab 3: 发行记录 - 统计卡片 + 历史记录列表
 */

import React, { useState } from 'react';
import './PointSellerTransactions.css';

const PointSellerTransactions = ({ statistics, records, onRefresh }) => {
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

  return (
    <div className="issuance-history">
      {/* 累计统计 */}
      <div style={styles.summaryWrapper}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryHeaderRow}>
            {/* 左边：标题 */}
            <div style={styles.summaryLeftCol}>
              <div style={styles.summaryLabel}>📈 累计统计</div>
            </div>
          </div>

          {/* 统计数据行：三列 */}
          <div style={styles.summaryStats}>
            {/* 点数卡统计 - 总点数 */}
            <div style={styles.summaryStatItem}>
              <div style={styles.summaryStatSubtitle}>
                {statistics.totalStats?.totalCardCount || 0} 张
              </div>
              <span style={styles.summaryStatValue}>{statistics.totalStats?.totalCardPoints || 0}</span>
              <span style={styles.summaryStatLabel}>卡片总点数</span>
            </div>
            <div style={styles.summaryStatDivider}></div>
            {/* 手机直销统计 - 总点数 */}
            <div style={styles.summaryStatItem}>
              <div style={styles.summaryStatSubtitle}>
                {statistics.totalStats?.totalMobileCount || 0} 笔
              </div>
              <span style={styles.summaryStatValue}>{statistics.totalStats?.totalMobilePoints || 0}</span>
              <span style={styles.summaryStatLabel}>手机总点数</span>
            </div>
            <div style={styles.summaryStatDivider}></div>
            {/* 现金统计 */}
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{formatAmount(statistics.totalStats?.totalCash || 0)}</span>
              <span style={styles.summaryStatLabel}>累计收现金</span>
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
            🛒 手机直销
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
                        {record.type === 'point_card' ? '🎫 点数卡' : '🛒 手机直销'}
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
                          ? (record.points || record.balance?.initial || record.issuer?.points || 0)
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

// ========== 样式 ==========
const styles = {
  summaryWrapper: { 
    width: '100%', 
    marginBottom: '1.5rem' 
  },
  summaryCard: { 
    padding: '1.25rem 0.65rem', 
    borderRadius: '12px', 
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)', 
    color: '#fff', 
    background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)'
  },
  summaryHeaderRow: { 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'stretch', 
    marginBottom: '1rem', 
    paddingBottom: '0.75rem', 
    borderBottom: '1px solid rgba(255, 255, 255, 0.2)', 
    gap: '0.5rem' 
  },
  summaryLeftCol: { 
    display: 'flex', 
    flexDirection: 'column', 
    alignItems: 'flex-start', 
    gap: '0.5rem', 
    flex: '1' 
  },
  summaryLabel: { 
    fontSize: '1rem', 
    opacity: 0.95, 
    fontWeight: '600' 
  },
  summaryStats: { 
    display: 'flex', 
    justifyContent: 'space-around', 
    alignItems: 'flex-start', 
    gap: '0.75rem', 
    flexWrap: 'nowrap' 
  },
  summaryStatItem: { 
    display: 'flex', 
    flexDirection: 'column', 
    alignItems: 'center', 
    flex: '1 1 150px', 
    textAlign: 'center' 
  },
  summaryStatValue: { 
    fontSize: '1.4rem', 
    fontWeight: '700', 
    marginBottom: '0.25rem' 
  },
  summaryStatLabel: { 
    fontSize: '0.85rem', 
    opacity: 0.85, 
    marginBottom: '0.25rem' 
  },
  summaryStatSubtitle: {
    fontSize: '0.85rem',
    opacity: 0.8,
    marginBottom: '0.5rem',
    fontWeight: '500'
  },
  summaryStatDivider: { 
    width: '1px', 
    backgroundColor: 'rgba(255, 255, 255, 0.2)', 
    alignSelf: 'stretch', 
    margin: '0 0.5rem' 
  }
};

export default PointSellerTransactions;
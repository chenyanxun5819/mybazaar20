/**
 * Issuance History Component
 * Tab 3: 发行记录 - 统计卡片 + 历史记录列表
 */

import React, { useState } from 'react';
import { formatPointSellerCustomerDisplay, formatShortDateTime } from '../../../components/common/transactionUtils';
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
          <div className="records-card-list" style={styles.cardList}>
            {filteredRecords.map(record => (
              <div key={record.id} style={styles.recordCard}>
                {/* 第一行：短日期 + 交易序号，分散对齐 */}
                <div style={styles.recordCardFirstRow}>
                  <div style={styles.recordCardDate}>
                    {formatShortDateTime(
                      record.transactionType === 'pointseller_card_issuance'
                        ? record.metadata?.createdAt
                        : record.timestamp
                    )}
                  </div>
                  <div style={styles.recordCardTransId}>
                    {record.transactionId || record.id}
                  </div>
                </div>

                {/* 第二行：根据类型显示不同内容 */}
                <div style={styles.recordCardSecondRow}>
                  {record.transactionType === 'pointseller_to_customer' ? (
                    <>
                      <div style={styles.recordCardName}>
                        {formatPointSellerCustomerDisplay(record)}
                      </div>
                      <div style={styles.recordCardQuantity}>
                        {record.pointAmount || record.amount || 0} pts
                      </div>
                    </>
                  ) : record.transactionType === 'pointseller_card_issuance' ? (
                    <>
                      <div style={styles.recordCardCardLabel}>
                        点数卡交易
                      </div>
                      <div style={styles.recordCardQuantity}>
                        {record.pointAmount || 0} pts
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
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
  },
  // === 卡片樣式 ===
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
  // 第一行：短日期 + 交易序号
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
  recordCardTransId: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  // 第二行：内容区域
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
  recordCardPhone: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  recordCardCardLabel: {
    flex: 1,
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  recordCardQuantity: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#3b82f6',
    whiteSpace: 'nowrap'
  },
  recordCardLabel: {
    fontSize: '0.625rem',
    color: '#9ca3af',
    fontWeight: '500'
  },
  recordCardValue: {
    fontSize: '0.8125rem',
    fontWeight: '700',
    color: '#1f2937'
  }
};

export default PointSellerTransactions;
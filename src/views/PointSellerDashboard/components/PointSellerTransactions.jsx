/**
 * Issuance History Component
 * Tab 3: 发行记录 - 统计卡片 + 历史记录列表
 */

import React, { useState } from 'react';
import { maskPhoneNumber } from '../../../services/transactionService';
import paymentQrcodeIcon from '../../../assets/payment-qrcode.svg';
import topupMobileIcon from '../../../assets/topup-mobile.svg';
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
                {/* 第一行：圖標、名稱、電話、日期 */}
                <div style={styles.recordCardHeader}>
                  <div style={styles.recordCardIconSection}>
                    <img
                      src={
                        record.transactionType === 'pointseller_card_issuance'
                          ? paymentQrcodeIcon
                          : topupMobileIcon
                      }
                      alt={record.transactionType}
                      style={styles.recordCardIcon}
                    />
                  </div>
                  <div style={styles.recordCardInfo}>
                    <div style={styles.recordCardName}>
                      {record.basicInfo?.englishName || record.customerName || '未知'}
                    </div>
                    <div style={styles.recordCardPhone}>
                      {maskPhoneNumber(record.basicInfo?.phoneNumber || record.customerPhone || '')}
                    </div>
                  </div>
                  <div style={styles.recordCardDate}>
                    {formatDateTime(
                      record.transactionType === 'pointseller_card_issuance'
                        ? record.metadata?.createdAt
                        : record.timestamp
                    )}
                  </div>
                </div>

                {/* 第二行：交易序號、金額 */}
                <div style={styles.recordCardContent}>
                  <div style={styles.recordCardTransId}>
                    <span style={styles.recordCardLabel}>交易序號</span>
                    <span style={styles.recordCardValue}>{record.transactionId || record.id}</span>
                  </div>
                  <div style={styles.recordCardAmount}>
                    <span style={styles.recordCardLabel}>金額</span>
                    <span style={styles.recordCardValue}>
                      {formatAmount(
                        record.transactionType === 'pointseller_card_issuance'
                          ? (record.issuer?.cashReceived || 0)
                          : (record.amount || 0)
                      )}
                    </span>
                  </div>
                </div>

                {/* 底部分隔線 */}
                <div style={styles.recordCardDivider} />
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
    marginBottom: '0.25rem'
  },
  recordCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    marginBottom: '0.5rem'
  },
  recordCardIconSection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  recordCardIcon: {
    width: '2.5rem',
    height: '2.5rem',
    objectFit: 'contain'
  },
  recordCardInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  recordCardName: {
    fontSize: '0.9375rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  recordCardPhone: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  recordCardDate: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    whiteSpace: 'nowrap',
    flexShrink: 0
  },
  recordCardContent: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.5rem',
    background: '#f9fafb',
    borderRadius: '6px',
    padding: '0.375rem 0.5rem',
    marginBottom: '0.25rem'
  },
  recordCardTransId: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1rem'
  },
  recordCardAmount: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1rem',
    textAlign: 'right'
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
  },
  recordCardDivider: {
    height: '1px',
    background: '#e5e7eb',
    marginTop: '0.375rem'
  }
};

export default PointSellerTransactions;
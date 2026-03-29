import React from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { maskPhoneNumber } from '../../../services/transactionService';
import HandshakeDealIcon from '../../../assets/handshake-deal-loan.svg?react';

export function TransactionHistory() {
  const { transactions, loading, error } = useTransactions();

  const getCustomerDisplayName = (tx) => {
    const englishName = tx.customerBasicInfo?.englishName?.trim();
    const phoneLastFour = tx.customerBasicInfo?.phoneNumber?.slice(-4);

    if (englishName && phoneLastFour) {
      return `${englishName} ${phoneLastFour}`;
    }

    if (englishName) {
      return englishName;
    }

    return tx.customerName || '未知';
  };

  if (loading) {
    return (
      <div className="transaction-history">
        <div className="loading-message">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="transaction-history">
        <h2 className="section-title">📋 交易历史</h2>
        <div className="error-message">错误: {error}</div>
      </div>
    );
  }

  // 格式化时间戳
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '未知时间';

    // Firestore Timestamp 对象
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  };

  // 计算总计
  const totalAmount = transactions.reduce((sum, tx) => sum + (tx.points || 0), 0);
  const totalCount = transactions.length;

  return (
    <>
      {transactions.length === 0 ? (
        <div className="no-transactions">
          <p>暂无交易记录</p>
          <p className="hint">完成第一笔销售后，记录将显示在这里</p>
        </div>
      ) : (
        <>
          {/* 统计摘要 */}
          <div className="transaction-summary">
            <div className="summary-stat-item">
              <span className="summary-stat-value">RM {totalAmount}</span>
              <span className="summary-stat-label">总销售额</span>
            </div>
            <div className="summary-stat-divider"></div>
            <div className="summary-stat-item">
              <span className="summary-stat-value">{totalCount} 笔</span>
              <span className="summary-stat-label">交易次数</span>
            </div>
          </div>

          {/* 交易列表 */}
          <div className="transactions-list">
            {transactions.map((tx) => (
              <div key={tx.id} className="transaction-card-item">
                {/* 左侧图标 */}
                <div className="transaction-card-icon" style={{ color: '#f44336' }}>
                  <HandshakeDealIcon width="28px" height="28px" />
                </div>

                {/* 中间信息 */}
                <div className="transaction-card-info">
                  <div className="transaction-card-date">
                    {formatTimestamp(tx.timestamp)}
                  </div>
                  <div className="transaction-card-customer">
                    {tx.customerBasicInfo?.englishName || '未知'}
                  </div>
                  <div className="transaction-card-phone">
                    {maskPhoneNumber(tx.customerBasicInfo?.phoneNumber || '')}
                  </div>
                </div>

                {/* 右侧金额 */}
                <div className="transaction-card-amount">
                  RM {tx.amount || 0}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}


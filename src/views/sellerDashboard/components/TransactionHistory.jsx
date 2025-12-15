import React from 'react';
import { useTransactions } from '../hooks/useTransactions';

export function TransactionHistory() {
  const { transactions, loading, error } = useTransactions();

  if (loading) {
    return (
      <div className="transaction-history">
        <h2 className="section-title">📋 交易历史</h2>
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
    <div className="transaction-history">
      <h2 className="section-title">📋 交易历史</h2>

      {transactions.length === 0 ? (
        <div className="no-transactions">
          <p>暂无交易记录</p>
          <p className="hint">完成第一笔销售后，记录将显示在这里</p>
        </div>
      ) : (
        <>
          {/* 交易列表 */}
          <div className="transactions-list">
            {transactions.map((tx) => (
              <div key={tx.id} className="transaction-item">
                <div className="transaction-header">
                  <span className="transaction-status completed">
                    🟢 已完成
                  </span>
                  <span className="transaction-time">
                    {formatTimestamp(tx.timestamp)}
                  </span>
                </div>
                <div className="transaction-details">
                  <div className="transaction-customer">
                    客户: <strong>{tx.customerName || '未知'}</strong>
                  </div>
                  <div className="transaction-amount">
                    金额: <strong className="amount-value">RM {tx.points || 0}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 统计摘要 */}
          <div className="transaction-summary">
            <div className="summary-item">
              <span className="summary-label">总销售额</span>
              <span className="summary-value">RM {totalAmount}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">交易次数</span>
              <span className="summary-value">{totalCount} 笔</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
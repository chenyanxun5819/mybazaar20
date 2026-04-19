import React from 'react';
import { useTransactions } from '../hooks/useTransactions';
import { formatCustomerDisplayName, formatShortDateTime, transactionListStyles } from '../../../components/common/transactionUtils';

export function SellerTransactions() {
  const { transactions, loading, error } = useTransactions();

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

  // 计算总计
  const totalAmount = transactions.reduce((sum, tx) => sum + (tx.points || 0), 0);
  const totalCount = transactions.length;
  const styles = transactionListStyles;

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
          <div style={styles.cardList}>
            {transactions.map((tx) => (
              <div key={tx.id} style={styles.recordCard}>
                {/* 第一行：短日期 + 交易序号，分散对齐 */}
                <div style={styles.recordCardFirstRow}>
                  <div style={styles.recordCardDate}>
                    {formatShortDateTime(tx.timestamp)}
                  </div>
                  <div style={styles.recordCardTransId}>
                    {tx.id}
                  </div>
                </div>

                {/* 第二行：客户信息 + 金额 */}
                <div style={styles.recordCardSecondRow}>
                  <div style={styles.recordCardName}>
                    {formatCustomerDisplayName(tx)}
                  </div>
                  <div style={styles.recordCardQuantity}>
                    RM {tx.amount || 0}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}


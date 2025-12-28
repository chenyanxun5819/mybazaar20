import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';

/**
 * Customer 交易记录页面
 * 
 * 功能：
 * 1. 显示所有交易记录（付款、转出、转入、充值）
 * 2. 按类型筛选
 * 3. 按时间排序
 * 4. 查看交易详情
 * 5. 刷新功能
 * 
 * 交易类型（符合 Firestore 架构规范）：
 * - customer_to_merchant: Customer付款给Merchant
 * - customer_transfer: Customer之间转账（转出/转入）
 * - point_card_topup: 点数卡充值
 */
const CustomerTransactions = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  
  // 用户数据
  const [customerData, setCustomerData] = useState(null);
  
  // 交易数据
  const [transactions, setTransactions] = useState([]);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  
  // 筛选和排序
  const [filterType, setFilterType] = useState('all'); // all | payment | transfer_out | transfer_in | topup
  const [sortOrder, setSortOrder] = useState('desc'); // desc | asc
  
  // 详情
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  
  // 加载状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadCustomerData();
  }, []);

  useEffect(() => {
    if (customerData) {
      loadTransactions();
    }
  }, [customerData]);

  useEffect(() => {
    filterAndSortTransactions();
  }, [transactions, filterType, sortOrder]);

  // 加载Customer数据
  const loadCustomerData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/universal-login');
        return;
      }

      const tokenResult = await user.getIdTokenResult();
      const { organizationId, eventId } = tokenResult.claims;

      if (!organizationId || !eventId) {
        setError('无法获取组织或活动信息');
        return;
      }

      setCustomerData({
        organizationId,
        eventId,
        userId: user.uid
      });
    } catch (error) {
      console.error('[CustomerTransactions] 加载Customer数据失败:', error);
      setError('加载失败：' + error.message);
    }
  };

  // 加载交易记录
  const loadTransactions = async () => {
    setLoading(true);
    setError(null);

    try {
      const transactionsRef = collection(
        db,
        'organizations', customerData.organizationId,
        'events', customerData.eventId,
        'transactions'
      );

      console.log('[CustomerTransactions] 开始加载交易记录...');

      // 查询与该Customer相关的交易
      // 包括：付款给Merchant、转出、转入、点数卡充值
      const queries = [
        // 1. 付款给Merchant
        query(
          transactionsRef,
          where('customerId', '==', customerData.userId),
          where('transactionType', '==', 'customer_to_merchant'),
          orderBy('timestamp', 'desc'),
          limit(50)
        ),
        // 2. 转出（作为转出方）
        query(
          transactionsRef,
          where('fromUser.userId', '==', customerData.userId),
          where('transactionType', '==', 'customer_transfer'),
          orderBy('timestamp', 'desc'),
          limit(50)
        ),
        // 3. 转入（作为接收方）
        query(
          transactionsRef,
          where('toUser.userId', '==', customerData.userId),
          where('transactionType', '==', 'customer_transfer'),
          orderBy('timestamp', 'desc'),
          limit(50)
        ),
        // 4. 点数卡充值
        query(
          transactionsRef,
          where('customerId', '==', customerData.userId),
          where('transactionType', '==', 'point_card_topup'),
          orderBy('timestamp', 'desc'),
          limit(50)
        )
      ];

      // 执行所有查询
      const results = await Promise.all(
        queries.map(q => getDocs(q).catch(err => {
          console.warn('[CustomerTransactions] 查询失败:', err);
          return { docs: [] };
        }))
      );

      // 合并结果（去重）
      const allTransactions = [];
      const seenIds = new Set();

      results.forEach(querySnap => {
        querySnap.docs.forEach(doc => {
          if (!seenIds.has(doc.id)) {
            seenIds.add(doc.id);
            allTransactions.push({
              id: doc.id,
              ...doc.data()
            });
          }
        });
      });

      console.log('[CustomerTransactions] 加载交易记录成功:', allTransactions.length);
      setTransactions(allTransactions);

    } catch (error) {
      console.error('[CustomerTransactions] 加载交易记录失败:', error);
      setError('加载失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 筛选和排序
  const filterAndSortTransactions = () => {
    let filtered = [...transactions];

    // 筛选
    if (filterType !== 'all') {
      filtered = filtered.filter(tx => {
        if (filterType === 'payment') {
          return tx.transactionType === 'customer_to_merchant';
        } else if (filterType === 'transfer_out') {
          return tx.transactionType === 'customer_transfer' && 
                 tx.fromUser?.userId === customerData.userId;
        } else if (filterType === 'transfer_in') {
          return tx.transactionType === 'customer_transfer' && 
                 tx.toUser?.userId === customerData.userId;
        } else if (filterType === 'topup') {
          return tx.transactionType === 'point_card_topup';
        }
        return true;
      });
    }

    // 排序
    filtered.sort((a, b) => {
      const timeA = a.timestamp?.toMillis() || 0;
      const timeB = b.timestamp?.toMillis() || 0;
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

    setFilteredTransactions(filtered);
  };

  // 格式化交易类型
  const getTransactionTypeLabel = (transaction) => {
    if (transaction.transactionType === 'customer_to_merchant') {
      return { label: '商家付款', icon: '💳', color: '#f44336' };
    } else if (transaction.transactionType === 'customer_transfer') {
      if (transaction.fromUser?.userId === customerData.userId) {
        return { label: '转出', icon: '📤', color: '#FF9800' };
      } else {
        return { label: '转入', icon: '📥', color: '#4CAF50' };
      }
    } else if (transaction.transactionType === 'point_card_topup') {
      return { label: '点数卡充值', icon: '🎫', color: '#2196F3' };
    }
    return { label: '未知', icon: '❓', color: '#999' };
  };

  // 格式化时间（相对时间）
  const formatTime = (timestamp) => {
    if (!timestamp) return '未知时间';
    const date = timestamp.toDate();
    const now = new Date();
    const diff = now - date;
    
    // 小于1分钟
    if (diff < 60000) {
      return '刚刚';
    }
    // 小于1小时
    if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}分钟前`;
    }
    // 小于1天
    if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}小时前`;
    }
    // 小于7天
    if (diff < 604800000) {
      return `${Math.floor(diff / 86400000)}天前`;
    }
    
    // 超过7天显示完整日期
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 格式化完整时间
  const formatFullTime = (timestamp) => {
    if (!timestamp) return '未知时间';
    const date = timestamp.toDate();
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 查看详情
  const handleViewDetail = (transaction) => {
    setSelectedTransaction(transaction);
  };

  // 关闭详情
  const handleCloseDetail = () => {
    setSelectedTransaction(null);
  };

  // 刷新
  const handleRefresh = () => {
    loadTransactions();
  };

  // 返回Dashboard
  const handleBack = () => {
    navigate(`/customer/${orgEventCode}/dashboard`);
  };

  if (!customerData) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 顶部导航 */}
      <div style={styles.header}>
        <button onClick={handleBack} style={styles.backButton}>
          ← 返回
        </button>
        <h1 style={styles.title}>交易记录</h1>
        <button onClick={handleRefresh} style={styles.refreshButton}>
          🔄
        </button>
      </div>

      {/* 筛选栏 */}
      <div style={styles.filterBar}>
        <div style={styles.filterButtons}>
          <button
            onClick={() => setFilterType('all')}
            style={{
              ...styles.filterButton,
              ...(filterType === 'all' ? styles.filterButtonActive : {})
            }}
          >
            全部
          </button>
          <button
            onClick={() => setFilterType('payment')}
            style={{
              ...styles.filterButton,
              ...(filterType === 'payment' ? styles.filterButtonActive : {})
            }}
          >
            💳 付款
          </button>
          <button
            onClick={() => setFilterType('transfer_out')}
            style={{
              ...styles.filterButton,
              ...(filterType === 'transfer_out' ? styles.filterButtonActive : {})
            }}
          >
            📤 转出
          </button>
          <button
            onClick={() => setFilterType('transfer_in')}
            style={{
              ...styles.filterButton,
              ...(filterType === 'transfer_in' ? styles.filterButtonActive : {})
            }}
          >
            📥 转入
          </button>
          <button
            onClick={() => setFilterType('topup')}
            style={{
              ...styles.filterButton,
              ...(filterType === 'topup' ? styles.filterButtonActive : {})
            }}
          >
            🎫 充值
          </button>
        </div>

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          style={styles.sortSelect}
        >
          <option value="desc">最新在前</option>
          <option value="asc">最早在前</option>
        </select>
      </div>

      {/* 交易列表 */}
      <div style={styles.content}>
        {loading && (
          <div style={styles.loadingSection}>
            <div style={styles.spinner}></div>
            <p>加载中...</p>
          </div>
        )}

        {error && (
          <div style={styles.errorCard}>
            <p>⚠️ {error}</p>
            <button onClick={handleRefresh} style={styles.retryButton}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && filteredTransactions.length === 0 && (
          <div style={styles.emptyCard}>
            <div style={styles.emptyIcon}>📭</div>
            <p style={styles.emptyText}>暂无交易记录</p>
            <p style={styles.emptySubtext}>
              {filterType !== 'all' 
                ? '尝试切换筛选条件' 
                : '开始使用MyBazaar进行交易吧！'}
            </p>
          </div>
        )}

        {!loading && !error && filteredTransactions.length > 0 && (
          <div style={styles.transactionList}>
            {filteredTransactions.map(tx => {
              const typeInfo = getTransactionTypeLabel(tx);
              const isNegative = tx.transactionType === 'customer_to_merchant' ||
                                (tx.transactionType === 'customer_transfer' && 
                                 tx.fromUser?.userId === customerData.userId);

              return (
                <div
                  key={tx.id}
                  onClick={() => handleViewDetail(tx)}
                  style={styles.transactionCard}
                >
                  <div style={styles.transactionLeft}>
                    <div style={{
                      ...styles.transactionIcon,
                      backgroundColor: typeInfo.color + '20'
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>{typeInfo.icon}</span>
                    </div>
                    <div style={styles.transactionInfo}>
                      <div style={styles.transactionType}>{typeInfo.label}</div>
                      <div style={styles.transactionTime}>{formatTime(tx.timestamp)}</div>
                      
                      {/* 交易对象 */}
                      {tx.transactionType === 'customer_to_merchant' && (
                        <div style={styles.transactionTarget}>
                          {tx.merchantName || '商家'}
                        </div>
                      )}
                      {tx.transactionType === 'customer_transfer' && (
                        <div style={styles.transactionTarget}>
                          {tx.fromUser?.userId === customerData.userId 
                            ? `转给 ${tx.toUser?.userName || '未知'}` 
                            : `来自 ${tx.fromUser?.userName || '未知'}`}
                        </div>
                      )}
                      {tx.transactionType === 'point_card_topup' && (
                        <div style={styles.transactionTarget}>
                          卡号：{tx.cardNumber || '未知'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={styles.transactionRight}>
                    <div style={{
                      ...styles.transactionAmount,
                      color: isNegative ? '#f44336' : '#4CAF50'
                    }}>
                      {isNegative ? '-' : '+'}{tx.amount}
                    </div>
                    <div style={styles.transactionArrow}>›</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 交易详情弹窗 */}
      {selectedTransaction && (
        <div style={styles.modal} onClick={handleCloseDetail}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>交易详情</h2>
              <button onClick={handleCloseDetail} style={styles.closeButton}>✕</button>
            </div>

            <div style={styles.modalBody}>
              {/* 交易类型 */}
              {(() => {
                const typeInfo = getTransactionTypeLabel(selectedTransaction);
                return (
                  <div style={styles.detailSection}>
                    <div style={styles.detailIconLarge}>{typeInfo.icon}</div>
                    <div style={styles.detailLabel}>{typeInfo.label}</div>
                  </div>
                );
              })()}

              {/* 金额 */}
              {(() => {
                const isNegative = selectedTransaction.transactionType === 'customer_to_merchant' ||
                                  (selectedTransaction.transactionType === 'customer_transfer' && 
                                   selectedTransaction.fromUser?.userId === customerData.userId);
                return (
                  <div style={styles.detailAmount}>
                    <span style={{ 
                      fontSize: '2.5rem',
                      fontWeight: '700',
                      color: isNegative ? '#f44336' : '#4CAF50' 
                    }}>
                      {isNegative ? '-' : '+'}{selectedTransaction.amount}
                    </span>
                    <span style={styles.detailUnit}>点</span>
                  </div>
                );
              })()}

              {/* 详细信息 */}
              <div style={styles.detailList}>
                <div style={styles.detailItem}>
                  <span style={styles.detailItemLabel}>交易ID：</span>
                  <span style={styles.detailItemValue}>{selectedTransaction.transactionId || selectedTransaction.id}</span>
                </div>

                <div style={styles.detailItem}>
                  <span style={styles.detailItemLabel}>时间：</span>
                  <span style={styles.detailItemValue}>
                    {formatFullTime(selectedTransaction.timestamp)}
                  </span>
                </div>

                <div style={styles.detailItem}>
                  <span style={styles.detailItemLabel}>状态：</span>
                  <span style={{
                    ...styles.detailItemValue,
                    color: selectedTransaction.status === 'completed' ? '#4CAF50' : '#FF9800'
                  }}>
                    {selectedTransaction.status === 'completed' ? '✅ 已完成' : '⏳ 处理中'}
                  </span>
                </div>

                {/* 商家付款详情 */}
                {selectedTransaction.transactionType === 'customer_to_merchant' && (
                  <>
                    <div style={styles.detailItem}>
                      <span style={styles.detailItemLabel}>商家：</span>
                      <span style={styles.detailItemValue}>{selectedTransaction.merchantName || '未知'}</span>
                    </div>
                    {selectedTransaction.pinVerified && (
                      <div style={styles.detailItem}>
                        <span style={styles.detailItemLabel}>验证：</span>
                        <span style={styles.detailItemValue}>🔒 交易密码已验证</span>
                      </div>
                    )}
                  </>
                )}

                {/* Customer转账详情 */}
                {selectedTransaction.transactionType === 'customer_transfer' && (
                  <>
                    <div style={styles.detailItem}>
                      <span style={styles.detailItemLabel}>转出方：</span>
                      <span style={styles.detailItemValue}>
                        {selectedTransaction.fromUser?.userName || '未知'}
                      </span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.detailItemLabel}>接收方：</span>
                      <span style={styles.detailItemValue}>
                        {selectedTransaction.toUser?.userName || '未知'}
                      </span>
                    </div>
                    {selectedTransaction.pinVerified && (
                      <div style={styles.detailItem}>
                        <span style={styles.detailItemLabel}>验证：</span>
                        <span style={styles.detailItemValue}>🔒 交易密码已验证</span>
                      </div>
                    )}
                  </>
                )}

                {/* 点数卡充值详情 */}
                {selectedTransaction.transactionType === 'point_card_topup' && (
                  <>
                    <div style={styles.detailItem}>
                      <span style={styles.detailItemLabel}>卡号：</span>
                      <span style={styles.detailItemValue}>{selectedTransaction.cardNumber || '未知'}</span>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.detailItemLabel}>卡片ID：</span>
                      <span style={styles.detailItemValue}>{selectedTransaction.cardId || '未知'}</span>
                    </div>
                  </>
                )}

                {/* 备注 */}
                {selectedTransaction.notes && (
                  <div style={styles.detailItem}>
                    <span style={styles.detailItemLabel}>备注：</span>
                    <span style={styles.detailItemValue}>{selectedTransaction.notes}</span>
                  </div>
                )}
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button onClick={handleCloseDetail} style={styles.closeModalButton}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 样式定义
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#fff',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    position: 'sticky',
    top: 0,
    zIndex: 10
  },
  backButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    backgroundColor: 'transparent',
    color: '#2196F3',
    border: 'none',
    cursor: 'pointer'
  },
  title: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#333',
    margin: 0
  },
  refreshButton: {
    padding: '0.5rem 1rem',
    fontSize: '1.2rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer'
  },
  filterBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#fff',
    borderBottom: '1px solid #eee',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  filterButtons: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    flex: 1
  },
  filterButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    backgroundColor: '#f5f5f5',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '20px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  filterButtonActive: {
    backgroundColor: '#2196F3',
    color: '#fff',
    border: '1px solid #2196F3'
  },
  sortSelect: {
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fff',
    cursor: 'pointer'
  },
  content: {
    padding: '1rem'
  },
  loadingSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '1rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #2196F3',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '1rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    margin: '2rem'
  },
  errorCard: {
    padding: '2rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    textAlign: 'center',
    border: '1px solid #f44336'
  },
  retryButton: {
    marginTop: '1rem',
    padding: '0.75rem 2rem',
    fontSize: '1rem',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  emptyCard: {
    padding: '3rem 2rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    textAlign: 'center'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  emptyText: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333',
    margin: '0.5rem 0'
  },
  emptySubtext: {
    fontSize: '0.9rem',
    color: '#999',
    margin: 0
  },
  transactionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  transactionCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  transactionLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flex: 1
  },
  transactionIcon: {
    width: '50px',
    height: '50px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  transactionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  transactionType: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#333'
  },
  transactionTime: {
    fontSize: '0.85rem',
    color: '#999'
  },
  transactionTarget: {
    fontSize: '0.85rem',
    color: '#666'
  },
  transactionRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  transactionAmount: {
    fontSize: '1.2rem',
    fontWeight: '700',
    textAlign: 'right'
  },
  transactionArrow: {
    fontSize: '1.5rem',
    color: '#ccc'
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '1px solid #eee'
  },
  modalTitle: {
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333',
    margin: 0
  },
  closeButton: {
    padding: '0.5rem',
    fontSize: '1.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#999'
  },
  modalBody: {
    padding: '2rem'
  },
  detailSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '2rem'
  },
  detailIconLarge: {
    fontSize: '4rem',
    marginBottom: '0.5rem'
  },
  detailLabel: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#666'
  },
  detailAmount: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  detailUnit: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#666',
    marginLeft: '0.5rem'
  },
  detailList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  detailItem: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingBottom: '1rem',
    borderBottom: '1px solid #f5f5f5'
  },
  detailItemLabel: {
    fontSize: '0.9rem',
    color: '#666'
  },
  detailItemValue: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#333',
    textAlign: 'right',
    maxWidth: '60%',
    wordBreak: 'break-all'
  },
  modalFooter: {
    padding: '1.5rem',
    borderTop: '1px solid #eee',
    display: 'flex',
    justifyContent: 'center'
  },
  closeModalButton: {
    padding: '0.75rem 2rem',
    fontSize: '1rem',
    fontWeight: '600',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  }
};

// 添加动画
if (typeof document !== 'undefined') {
  const styleSheet = document.styleSheets[0];
  const keyframes = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  `;
  try {
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
  } catch (e) {
    // 动画可能已存在
  }
}

export default CustomerTransactions;
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import refreshIcon from '../../assets/refresh.svg';
import paidIcon from '../../assets/paid.svg';
import walletIncomeIcon from '../../assets/wallet-income.svg';
import walletArrowIcon from '../../assets/wallet-arrow.svg';
import walletMoneyIcon from '../../assets/wallet-money.svg';
import calculatorBillIcon from '../../assets/calculator-bill.svg';

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

// SVG Icon 组件
const SVGIcon = ({ src, color = 'currentColor', width = '24px', height = '24px', className = '' }) => {
  return (
    <img 
      src={src}
      alt="icon"
      style={{
        width,
        height,
        filter: color !== 'currentColor' ? `hue-rotate(0deg) saturate(1)` : undefined
      }}
      className={className}
    />
  );
};

const CustomerTransactions = ({ embedded = false }) => {
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
      return { label: '商家付款', icon: paidIcon, iconColor: '#f44336', color: '#f44336' };
    } else if (transaction.transactionType === 'customer_transfer') {
      if (transaction.fromUser?.userId === customerData.userId) {
        return { label: '转出', icon: walletArrowIcon, iconColor: '#FF9800', color: '#FF9800' };
      } else {
        return { label: '转入', icon: walletIncomeIcon, iconColor: '#4CAF50', color: '#4CAF50' };
      }
    } else if (transaction.transactionType === 'point_card_topup') {
      return { label: '点数卡充值', icon: walletMoneyIcon, iconColor: '#2196F3', color: '#2196F3' };
    }
    return { label: '未知', icon: calculatorBillIcon, iconColor: '#999', color: '#999' };
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
      <div style={{ ...styles.container, ...(embedded ? styles.embeddedContainer : {}) }}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  const contentStyle = embedded ? { ...styles.content, ...styles.embeddedContent } : styles.content;

  return (
    <div style={{ ...styles.container, ...(embedded ? styles.embeddedContainer : {}) }}>
      {/* 筛选栏 */}
      <div style={styles.filterBar}>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={styles.filterSelect}
        >
          <option value="all">全部</option>
          <option value="payment">付款</option>
          <option value="transfer_out">转出</option>
          <option value="transfer_in">转入</option>
          <option value="topup">充值</option>
        </select>

        <div style={styles.headerRight}>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            style={styles.sortSelect}
          >
            <option value="desc">最新在前</option>
            <option value="asc">最早在前</option>
          </select>
          <button onClick={handleRefresh} style={styles.refreshButton}>
            <SVGIcon src={refreshIcon} color="#2196F3" width="24px" height="24px" />
          </button>
        </div>
      </div>

      {/* 交易列表 */}
      <div style={contentStyle}>
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

              // 🎨 根据状态获取颜色和标签
              const getStatusBadge = (status) => {
                if (status === 'completed') return { label: '✅', bg: '#4CAF5020', color: '#4CAF50' };
                if (status === 'refunded') return { label: '💰 已退款', bg: '#FF980020', color: '#FF9800' };
                if (status === 'cancelled') return { label: '❌ 已取消', bg: '#f4433620', color: '#f44336' };
                if (status === 'pending') return { label: '⏳', bg: '#2196F320', color: '#2196F3' };
                return { label: '？', bg: '#99999920', color: '#999' };
              };
              const statusBadge = getStatusBadge(tx.status);

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
                      <SVGIcon 
                        src={typeInfo.icon} 
                        color={typeInfo.iconColor}
                        width="28px" 
                        height="28px" 
                      />
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
                    {/* 🎨 状态徽章 */}
                    {tx.status !== 'completed' && (
                      <div style={{
                        ...styles.statusBadge,
                        backgroundColor: statusBadge.bg,
                        color: statusBadge.color
                      }}>
                        {statusBadge.label}
                      </div>
                    )}
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
                    <div style={styles.detailIconLarge}>
                      <SVGIcon 
                        src={typeInfo.icon}
                        color={typeInfo.iconColor}
                        width="80px"
                        height="80px"
                      />
                    </div>
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
                    color: selectedTransaction.status === 'completed' ? '#4CAF50' 
                           : selectedTransaction.status === 'refunded' ? '#FF9800'
                           : selectedTransaction.status === 'cancelled' ? '#f44336'
                           : '#2196F3'
                  }}>
                    {selectedTransaction.status === 'completed' ? '✅ 已完成' 
                     : selectedTransaction.status === 'refunded' ? '💰 已退款'
                     : selectedTransaction.status === 'cancelled' ? '❌ 已取消'
                     : selectedTransaction.status === 'pending' ? '⏳ 待处理'
                     : '？ 未知'}
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
    backgroundColor: '#f5f5f5',
    width: '100%',
    maxWidth: '100%',
    overflowX: 'hidden',
    boxSizing: 'border-box'
  },
  embeddedContainer: {
    minHeight: 'auto',
    backgroundColor: 'transparent'
  },
  filterBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1rem',
    backgroundColor: '#fff',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    gap: '1rem',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box'
  },
  filterSelect: {
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    border: '1px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: '#333',
    cursor: 'pointer',
    transition: 'all 0.2s',
    minWidth: '150px'
  },
  filterButtons: {
    display: 'flex',
    gap: '1.5rem',
    flex: 1,
    alignItems: 'center'
  },
  filterLink: {
    fontSize: '0.95rem',
    color: '#666',
    cursor: 'pointer',
    transition: 'all 0.2s',
    padding: '0.5rem 0',
    borderBottom: '2px solid transparent',
    fontWeight: '500'
  },
  filterLinkActive: {
    color: '#2196F3',
    borderBottom: '2px solid #2196F3'
  },
  headerRight: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
    minWidth: 0
  },
  refreshButton: {
    padding: '0.25rem 1rem',
    fontSize: '1.2rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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
    width: '100%',
    maxWidth: 'none',
    minWidth: 0,
    padding: '0 1rem 1rem',
    boxSizing: 'border-box'
  },
  embeddedContent: {
    padding: '0 0 1rem'
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
    padding: '2rem 1rem',
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
    gap: '0.35rem',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0
  },
  transactionCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.625rem 1rem',
    backgroundColor: '#fff',
    borderRadius: '10px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box'
  },
  transactionLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flex: 1,
    minWidth: 0
  },
  transactionIcon: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  transactionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.125rem',
    minWidth: 0,
    flex: 1
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
    gap: '0.5rem',
    minWidth: 0,
    flexShrink: 0
  },
  transactionAmount: {
    fontSize: '1.2rem',
    fontWeight: '700',
    textAlign: 'right'
  },
  statusBadge: {
    fontSize: '0.75rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap'
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
    padding: '0.5rem 1rem'
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '10px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '85vh',
    overflow: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    boxSizing: 'border-box'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.875rem 1.5rem',
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
    padding: '1rem 2rem'
  },
  detailSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  detailIconLarge: {
    fontSize: '4rem',
    marginBottom: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '84px'
  },
  detailLabel: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#666'
  },
  detailAmount: {
    textAlign: 'center',
    marginBottom: '1rem'
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
    gap: '0.5rem'
  },
  detailItem: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingBottom: '0.5rem',
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
    padding: '0.875rem 1.5rem',
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


import { useState, useEffect } from 'react';
import { Receipt, Search, Filter, ChevronDown, RefreshCw, Calendar, CheckCircle, XCircle, RotateCcw, User } from 'lucide-react';
import { db } from '../../config/firebase';
import { collection, query, where, orderBy, limit as firestoreLimit, getDocs } from 'firebase/firestore';
import { 
  maskPhoneNumber,
  formatAmount,
  formatTransactionTime,
  getTransactionStatusDisplay
} from '../../services/transactionService';
import './MerchantTransactions.css';

/**
 * TransactionCard - 单个交易卡片（Mobile 优化）
 * ⭐ 支持显示收点数人信息、操作按钮
 */
const TransactionCard = ({ transaction, userRole, onRefund }) => {
  const statusInfo = getTransactionStatusDisplay(transaction.status);
  const StatusIcon = require('lucide-react')[statusInfo.icon];
  const isMerchantOwner = userRole === 'merchantOwner';
  const canRefund = isMerchantOwner && transaction.status === 'completed';

  return (
    <div className="transaction-card">
      <div className="transaction-card-content">
        <div className="transaction-card-info">
          <div className="transaction-card-time">
            <Receipt />
            <span>{formatTransactionTime(transaction.timestamp)}</span>
          </div>
          <p className="transaction-card-customer">
            顾客：{maskPhoneNumber(transaction.customerPhone)}
          </p>
          {/* ⭐ 显示收点数人信息 */}
          {transaction.collectedBy && transaction.collectorRole && (
            <p className="transaction-card-collector">
              <User />
              收款人：
              {transaction.collectorRole === 'merchantOwner' && '摊主'}
              {transaction.collectorRole === 'merchantAsist' && '助理'}
            </p>
          )}
        </div>
        <div className="transaction-card-amount">
          <span className="amount-value">{formatAmount(transaction.amount)}</span>
          <span className="amount-unit">点</span>
        </div>
      </div>

      {/* 状态标签 */}
      <div className="transaction-card-footer">
        <span className={`transaction-status-badge ${statusInfo.bgColor} ${statusInfo.color}`}>
          <StatusIcon />
          {statusInfo.text}
        </span>
        <span className="transaction-card-id">
          #{transaction.id.substring(0, 8)}
        </span>
      </div>

      {/* ⭐ 操作按钮（仅 merchantOwner 可退款） */}
      {canRefund && (
        <div className="transaction-card-actions">
          <button
            onClick={() => onRefund(transaction)}
            className="refund-btn"
          >
            <RotateCcw />
            退款
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * PendingTransactionCard - 待收交易卡片
 */
const PendingTransactionCard = ({ transaction, onConfirm, onCancel }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(transaction.id);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      await onCancel(transaction.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pending-transaction-card">
      <div className="pending-transaction-info">
        <div className="pending-customer-info">
          <p className="customer-name">{transaction.customerName || '顾客'}</p>
          <p className="customer-phone">{maskPhoneNumber(transaction.customerPhone)}</p>
        </div>
        <div className="pending-amount">
          <span className="amount-value">{formatAmount(transaction.amount)}</span>
          <span className="amount-unit">点</span>
        </div>
      </div>
      <div className="pending-transaction-time">
        {formatTransactionTime(transaction.timestamp)}
      </div>
      <div className="pending-transaction-actions">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="confirm-btn"
        >
          <CheckCircle />
          {loading ? '处理中...' : '待收'}
        </button>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="cancel-btn"
        >
          <XCircle />
          取消
        </button>
      </div>
    </div>
  );
};

/**
 * MerchantTransactions - 交易记录主组件
 * ⭐ 支持 merchantOwner 和 merchantAsist 角色
 * @param {Object} props
 * @param {Object} props.merchant - 商家资料
 * @param {string} props.organizationId - 组织 ID
 * @param {string} props.eventId - 活动 ID
 * @param {string} props.userRole - 用户角色 (merchantOwner | merchantAsist)
 * @param {string} props.currentUserId - 当前用户 ID
 */
const MerchantTransactions = ({ merchant, organizationId, eventId, userRole, currentUserId }) => {
  const [transactions, setTransactions] = useState([]);
  const [pendingTransactions, setPendingTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterBy, setFilterBy] = useState('all'); // 'all' | 'today' | 'week'
  const [showFilter, setShowFilter] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('completed'); // 'pending' | 'completed'

  const isMerchantOwner = userRole === 'merchantOwner';
  const isMerchantAsist = userRole === 'merchantAsist';

  // 加载待收交易（pending）
  const loadPendingTransactions = async () => {
    if (!merchant?.id || !organizationId || !eventId) return;

    try {
      const transactionsRef = collection(
        db,
        'organizations', organizationId,
        'events', eventId,
        'transactions'
      );

      let q = query(
        transactionsRef,
        where('merchantId', '==', merchant.id),
        where('status', '==', 'pending'),
        orderBy('timestamp', 'desc'),
        firestoreLimit(20)
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setPendingTransactions(data);
    } catch (err) {
      console.error('Error loading pending transactions:', err);
    }
  };

  // 加载已完成交易记录
  const loadCompletedTransactions = async () => {
    if (!merchant?.id || !organizationId || !eventId) return;

    try {
      setLoading(true);
      setError(null);

      const transactionsRef = collection(
        db,
        'organizations', organizationId,
        'events', eventId,
        'transactions'
      );

      // ⭐ 根据角色构建不同的查询
      let q;
      
      if (isMerchantAsist) {
        // merchantAsist: 只查看自己收取的交易
        q = query(
          transactionsRef,
          where('merchantId', '==', merchant.id),
          where('collectedBy', '==', currentUserId),
          where('status', 'in', ['completed', 'cancelled', 'refunded']),
          orderBy('timestamp', 'desc'),
          firestoreLimit(50)
        );
      } else {
        // merchantOwner: 查看所有交易
        q = query(
          transactionsRef,
          where('merchantId', '==', merchant.id),
          where('status', 'in', ['completed', 'cancelled', 'refunded']),
          orderBy('timestamp', 'desc'),
          firestoreLimit(50)
        );
      }

      const snapshot = await getDocs(q);
      let data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // ⭐ 前端时间过滤（如果需要）
      if (filterBy === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        data = data.filter(t => {
          const txDate = t.timestamp?.toDate();
          return txDate >= today;
        });
      } else if (filterBy === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        data = data.filter(t => {
          const txDate = t.timestamp?.toDate();
          return txDate >= weekAgo;
        });
      }

      setTransactions(data);
    } catch (err) {
      console.error('Error loading transactions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    loadPendingTransactions();
    loadCompletedTransactions();
  }, [merchant?.id, organizationId, eventId, filterBy, userRole, currentUserId]);

  // 确认收款
  const handleConfirmPayment = async (transactionId) => {
    try {
      // TODO: 调用 Cloud Function: confirmMerchantPayment
      console.log('Confirming payment:', transactionId);
      alert('确认收款功能开发中...\n请等待 Cloud Function 部署完成');
      
      // const confirmPayment = httpsCallable(functions, 'confirmMerchantPayment');
      // await confirmPayment({
      //   organizationId,
      //   eventId,
      //   transactionId
      // });
      
      // 重新加载数据
      // await loadPendingTransactions();
      // await loadCompletedTransactions();
    } catch (error) {
      console.error('Error confirming payment:', error);
      alert('确认收款失败：' + error.message);
    }
  };

  // 取消交易
  const handleCancelPayment = async (transactionId) => {
    try {
      const reason = prompt('请输入取消原因（可选）:');
      
      // TODO: 调用 Cloud Function: cancelMerchantPayment
      console.log('Cancelling payment:', transactionId, 'Reason:', reason);
      alert('取消交易功能开发中...\n请等待 Cloud Function 部署完成');
      
      // const cancelPayment = httpsCallable(functions, 'cancelMerchantPayment');
      // await cancelPayment({
      //   organizationId,
      //   eventId,
      //   transactionId,
      //   cancelReason: reason || undefined
      // });
      
      // 重新加载数据
      // await loadPendingTransactions();
      // await loadCompletedTransactions();
    } catch (error) {
      console.error('Error cancelling payment:', error);
      alert('取消交易失败：' + error.message);
    }
  };

  // 退款（仅 merchantOwner）
  const handleRefund = async (transaction) => {
    if (!isMerchantOwner) {
      alert('只有摊主可以退款');
      return;
    }

    const confirmed = confirm(
      `确定要退款吗？\n\n` +
      `交易金额：${transaction.amount} 点\n` +
      `顾客：${maskPhoneNumber(transaction.customerPhone)}\n` +
      `交易时间：${formatTransactionTime(transaction.timestamp)}`
    );

    if (!confirmed) return;

    const reason = prompt('请输入退款原因（必填）:');
    if (!reason || !reason.trim()) {
      alert('退款原因不能为空');
      return;
    }

    try {
      // TODO: 调用 Cloud Function: refundMerchantPayment
      console.log('Refunding transaction:', transaction.id, 'Reason:', reason);
      alert('退款功能开发中...\n请等待 Cloud Function 部署完成');
      
      // const refundPayment = httpsCallable(functions, 'refundMerchantPayment');
      // await refundPayment({
      //   organizationId,
      //   eventId,
      //   transactionId: transaction.id,
      //   refundReason: reason
      // });
      
      // 重新加载数据
      // await loadCompletedTransactions();
    } catch (error) {
      console.error('Error refunding payment:', error);
      alert('退款失败：' + error.message);
    }
  };

  // 搜索过滤
  const filteredTransactions = transactions.filter(transaction => {
    if (!searchTerm) return true;
    const phone = transaction.customerPhone?.toLowerCase() || '';
    const id = transaction.id?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    return phone.includes(search) || id.includes(search);
  });

  // 筛选选项
  const filterOptions = [
    { value: 'all', label: '全部', icon: Calendar },
    { value: 'today', label: '今日', icon: Calendar },
    { value: 'week', label: '本周', icon: Calendar }
  ];

  // 统计数据
  const totalAmount = filteredTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalCount = filteredTransactions.length;
  const pendingCount = pendingTransactions.length;

  if (loading && activeTab === 'completed') {
    return (
      <div className="merchant-transactions-loading">
        <div className="merchant-transactions-loading-content">
          <div className="merchant-transactions-loading-spinner"></div>
          <p className="merchant-transactions-loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="merchant-transactions-error">
        <p>{error}</p>
        <button onClick={loadCompletedTransactions}>
          <RefreshCw />
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="merchant-transactions-container">
      {/* ⭐ Tabs: 待收 vs 历史 */}
      <div className="merchant-transactions-tabs">
        <button
          onClick={() => setActiveTab('pending')}
          className={`tab-btn ${activeTab === 'pending' ? 'active' : 'inactive'}`}
        >
          <Receipt />
          待收点数
          {pendingCount > 0 && <span className="tab-badge">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`tab-btn ${activeTab === 'completed' ? 'active' : 'inactive'}`}
        >
          <Calendar />
          交易历史
          {totalCount > 0 && <span className="tab-count">({totalCount})</span>}
        </button>
      </div>

      {/* ⭐ 待收点数列表 */}
      {activeTab === 'pending' && (
        <div className="pending-transactions-container">
          <div className="pending-transactions-header">
            <h3>待收点数</h3>
            <button onClick={loadPendingTransactions} className="refresh-btn">
              <RefreshCw />
            </button>
          </div>
          {pendingTransactions.length === 0 ? (
            <div className="pending-transactions-empty">
              <Receipt />
              <p>暂无待收点数</p>
              <p className="empty-hint">当顾客扫码付款后，会显示在这里</p>
            </div>
          ) : (
            <div className="pending-transactions-list">
              {pendingTransactions.map((transaction) => (
                <PendingTransactionCard
                  key={transaction.id}
                  transaction={transaction}
                  onConfirm={handleConfirmPayment}
                  onCancel={handleCancelPayment}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ⭐ 交易历史 */}
      {activeTab === 'completed' && (
        <>
          {/* Header: 统计和操作 */}
          <div className="merchant-transactions-header">
            <div className="merchant-transactions-summary">
              <div className="merchant-transactions-filter-info">
                <div className="filter-label">
                  <p>筛选范围</p>
                  <p className="filter-value">
                    {filterOptions.find(f => f.value === filterBy)?.label}
                  </p>
                </div>
              </div>
              <div className="merchant-transactions-total">
                <div className="total-amount">
                  <p>总金额</p>
                  <p className="total-value">{formatAmount(totalAmount)} 点</p>
                </div>
              </div>
            </div>
            <div className="merchant-transactions-count">
              <Receipt />
              <span>共 {totalCount} 笔交易</span>
              {isMerchantAsist && (
                <span className="role-badge">（仅个人）</span>
              )}
            </div>
          </div>

          {/* 搜索和筛选 */}
          <div className="merchant-transactions-controls">
            {/* 搜索框 */}
            <div className="merchant-search-wrapper">
              <Search className="merchant-search-icon" />
              <input
                type="text"
                placeholder="搜索电话或交易编号..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="merchant-search-input"
              />
            </div>

            {/* 筛选按钮 */}
            <button
              onClick={() => setShowFilter(!showFilter)}
              className={`merchant-filter-btn ${showFilter ? 'active' : 'inactive'}`}
            >
              <Filter />
              筛选
              <ChevronDown className={`merchant-filter-chevron ${showFilter ? 'rotated' : ''}`} />
            </button>

            {/* 刷新按钮 */}
            <button
              onClick={loadCompletedTransactions}
              className="merchant-refresh-btn"
            >
              <RefreshCw />
            </button>
          </div>

          {/* 筛选选项 */}
          {showFilter && (
            <div className="merchant-filter-panel">
              <p className="filter-panel-title">时间范围</p>
              <div className="merchant-filter-options">
                {filterOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        setFilterBy(option.value);
                        setShowFilter(false);
                      }}
                      className={`merchant-filter-option ${filterBy === option.value ? 'active' : 'inactive'}`}
                    >
                      <Icon />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 交易列表 */}
          <div className="merchant-transactions-list">
            {filteredTransactions.length === 0 ? (
              <div className="merchant-transactions-empty">
                <Receipt />
                <p>暂无交易记录</p>
                <p className="empty-hint">
                  {searchTerm ? '没有符合搜索条件的交易' : 
                   isMerchantAsist ? '当您收取付款后，交易记录会显示在这里' :
                   '当您收到付款时，交易记录会显示在这里'}
                </p>
              </div>
            ) : (
              filteredTransactions.map((transaction) => (
                <TransactionCard
                  key={transaction.id}
                  transaction={transaction}
                  userRole={userRole}
                  onRefund={handleRefund}
                />
              ))
            )}
          </div>

          {/* 加载更多（如果需要） */}
          {filteredTransactions.length >= 50 && (
            <div className="merchant-transactions-load-more">
              <button>加载更多</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MerchantTransactions;
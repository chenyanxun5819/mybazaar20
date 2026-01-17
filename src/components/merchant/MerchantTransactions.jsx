import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db, functions } from '../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { 
  Receipt, 
  Clock, 
  CheckCircle, 
  XCircle, 
  ArrowLeftRight,
  AlertCircle,
  RefreshCw,
  Bell,
  User,
  Calendar
} from 'lucide-react';
import { formatAmount, maskPhoneNumber } from '../../services/transactionService';
import './MerchantTransactions.css';

/**
 * PendingPaymentCard - 待收点数卡片
 * 用于 pending tab，显示等待确认的付款
 */
const PendingPaymentCard = ({ payment, onConfirm, onCancel, userRole, loading }) => {
  const [actionLoading, setActionLoading] = useState(false);

  const handleConfirm = async () => {
    setActionLoading(true);
    try {
      await onConfirm(payment.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    setActionLoading(true);
    try {
      await onCancel(payment.id);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="pending-payment-card">
      <div className="pending-payment-header">
        <div className="pending-payment-customer">
          <div className="customer-avatar">
            <User />
          </div>
          <div className="customer-info">
            <p className="customer-name">{payment.customerName || '顾客'}</p>
            <p className="customer-phone">{maskPhoneNumber(payment.customerPhone)}</p>
          </div>
        </div>
        <div className="pending-payment-amount">
          <span className="amount-value">{formatAmount(payment.amount)}</span>
          <span className="amount-unit">点</span>
        </div>
      </div>
      
      <div className="pending-payment-time">
        <Clock className="time-icon" />
        {new Date(payment.timestamp?.toDate()).toLocaleString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })}
      </div>

      <div className="pending-payment-actions">
        <button
          onClick={handleConfirm}
          disabled={actionLoading || loading}
          className="confirm-btn"
        >
          <CheckCircle />
          {actionLoading ? '处理中...' : '确认收款'}
        </button>
        <button
          onClick={handleCancel}
          disabled={actionLoading || loading}
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
 * TransactionCard - 交易记录卡片
 * 用于 today 和 all tabs，显示历史交易
 */
const TransactionCard = ({ transaction, onRefund, userRole, currentUserId }) => {
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      alert('请输入退款原因');
      return;
    }

    setRefunding(true);
    try {
      await onRefund(transaction.id, refundReason);
      setShowRefundDialog(false);
      setRefundReason('');
    } finally {
      setRefunding(false);
    }
  };

  // ⭐ 判断是否显示退款按钮
  // 只有 merchantOwner 可以退款 completed 交易
  const canRefund = userRole === 'merchantOwner' && transaction.status === 'completed';

  // 状态图标和颜色
  const getStatusConfig = (status) => {
    const configs = {
      completed: {
        icon: CheckCircle,
        label: '已完成',
        color: 'green',
        bgColor: '#e8f5e9'
      },
      cancelled: {
        icon: XCircle,
        label: '已取消',
        color: 'gray',
        bgColor: '#f5f5f5'
      },
      refunded: {
        icon: ArrowLeftRight,
        label: '已退款',
        color: 'orange',
        bgColor: '#fff3e0'
      },
      pending: {
        icon: Clock,
        label: '待确认',
        color: 'blue',
        bgColor: '#e3f2fd'
      }
    };
    return configs[status] || configs.pending;
  };

  const statusConfig = getStatusConfig(transaction.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="transaction-card">
      {/* Header */}
      <div className="transaction-header">
        <div className="transaction-customer">
          <div className="customer-avatar">
            <User />
          </div>
          <div className="customer-info">
            <p className="customer-name">{transaction.customerName || '顾客'}</p>
            <p className="customer-phone">{maskPhoneNumber(transaction.customerPhone)}</p>
          </div>
        </div>
        <div 
          className="transaction-status"
          style={{ 
            color: statusConfig.color,
            backgroundColor: statusConfig.bgColor
          }}
        >
          <StatusIcon className="status-icon" />
          {statusConfig.label}
        </div>
      </div>

      {/* Amount */}
      <div className="transaction-amount">
        <span className="amount-value">{formatAmount(transaction.amount)}</span>
        <span className="amount-unit">点</span>
      </div>

      {/* Details */}
      <div className="transaction-details">
        <div className="detail-row">
          <span className="detail-label">交易时间</span>
          <span className="detail-value">
            {new Date(transaction.timestamp?.toDate()).toLocaleString('zh-CN')}
          </span>
        </div>
        
        {transaction.collectedBy && (
          <div className="detail-row">
            <span className="detail-label">收款人</span>
            <span className="detail-value">
              {transaction.collectorRole === 'merchantOwner' ? '摊主' : '助理'}
            </span>
          </div>
        )}

        {transaction.refundReason && (
          <div className="detail-row">
            <span className="detail-label">退款原因</span>
            <span className="detail-value refund-reason">
              {transaction.refundReason}
            </span>
          </div>
        )}

        {transaction.cancelReason && (
          <div className="detail-row">
            <span className="detail-label">取消原因</span>
            <span className="detail-value cancel-reason">
              {transaction.cancelReason}
            </span>
          </div>
        )}
      </div>

      {/* Refund Button (merchantOwner only) */}
      {canRefund && (
        <div className="transaction-actions">
          <button
            onClick={() => setShowRefundDialog(true)}
            className="refund-btn"
          >
            <ArrowLeftRight />
            退款
          </button>
        </div>
      )}

      {/* Refund Dialog */}
      {showRefundDialog && (
        <div className="refund-dialog-overlay">
          <div className="refund-dialog">
            <h3 className="refund-dialog-title">确认退款</h3>
            <p className="refund-dialog-info">
              退款金额：<strong>{formatAmount(transaction.amount)} 点</strong>
            </p>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="请输入退款原因（必填）"
              rows={3}
              className="refund-reason-input"
            />
            <div className="refund-dialog-actions">
              <button
                onClick={handleRefund}
                disabled={refunding || !refundReason.trim()}
                className="refund-confirm-btn"
              >
                {refunding ? '处理中...' : '确认退款'}
              </button>
              <button
                onClick={() => {
                  setShowRefundDialog(false);
                  setRefundReason('');
                }}
                disabled={refunding}
                className="refund-cancel-btn"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * MerchantTransactions - 商家交易记录组件
 * ⭐ 新版本：包含 pending tab 和待收点数列表
 * 
 * @param {Object} props
 * @param {Object} props.merchant - 商家资料
 * @param {string} props.organizationId - 组织 ID
 * @param {string} props.eventId - 活动 ID
 * @param {string} props.userRole - 用户角色 (merchantOwner | merchantAsist)
 * @param {string} props.currentUserId - 当前用户 ID（用于 merchantAsist 筛选）
 */
const MerchantTransactions = ({ 
  merchant, 
  organizationId, 
  eventId, 
  userRole,
  currentUserId 
}) => {
  const [currentTab, setCurrentTab] = useState('pending');
  const [pendingPayments, setPendingPayments] = useState([]);
  const [todayTransactions, setTodayTransactions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ⭐ Tab 配置
  const tabs = [
    { id: 'pending', label: '待收点数', icon: Bell },
    { id: 'today', label: '今日', icon: Calendar },
    { id: 'all', label: '全部', icon: Receipt }
  ];

  // ============================================
  // ⭐ 1. 监听 Pending 交易（待收点数）
  // ============================================
  useEffect(() => {
    if (!merchant?.id || !organizationId || !eventId) return;

    const transactionsRef = collection(
      db, 
      'organizations', organizationId, 
      'events', eventId, 
      'transactions'
    );

    const q = query(
      transactionsRef,
      where('merchantId', '==', merchant.id),
      where('status', '==', 'pending'),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const payments = [];
        snapshot.forEach((doc) => {
          payments.push({
            id: doc.id,
            ...doc.data()
          });
        });
        setPendingPayments(payments);
      },
      (err) => {
        console.error('Error listening to pending payments:', err);
        setError('加载待收点数失败');
      }
    );

    return () => unsubscribe();
  }, [merchant?.id, organizationId, eventId]);

  // ============================================
  // ⭐ 2. 监听今日交易
  // ============================================
  useEffect(() => {
    if (!merchant?.id || !organizationId || !eventId) return;

    const transactionsRef = collection(
      db, 
      'organizations', organizationId, 
      'events', eventId, 
      'transactions'
    );

    // 获取今天的开始时间（00:00:00）
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // ⭐ 根据角色筛选交易
    let q;
    if (userRole === 'merchantAsist') {
      // merchantAsist 只能看自己确认的交易
      q = query(
        transactionsRef,
        where('merchantId', '==', merchant.id),
        where('collectedBy', '==', currentUserId),
        where('timestamp', '>=', Timestamp.fromDate(todayStart)),
        orderBy('timestamp', 'desc')
      );
    } else {
      // merchantOwner 可以看所有交易
      q = query(
        transactionsRef,
        where('merchantId', '==', merchant.id),
        where('timestamp', '>=', Timestamp.fromDate(todayStart)),
        orderBy('timestamp', 'desc')
      );
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const transactions = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // 只显示非 pending 的交易
          if (data.status !== 'pending') {
            transactions.push({
              id: doc.id,
              ...data
            });
          }
        });
        setTodayTransactions(transactions);
      },
      (err) => {
        console.error('Error listening to today transactions:', err);
        setError('加载今日交易失败');
      }
    );

    return () => unsubscribe();
  }, [merchant?.id, organizationId, eventId, userRole, currentUserId]);

  // ============================================
  // ⭐ 3. 监听所有交易
  // ============================================
  useEffect(() => {
    if (!merchant?.id || !organizationId || !eventId) return;

    const transactionsRef = collection(
      db, 
      'organizations', organizationId, 
      'events', eventId, 
      'transactions'
    );

    // ⭐ 根据角色筛选交易
    let q;
    if (userRole === 'merchantAsist') {
      // merchantAsist 只能看自己确认的交易
      q = query(
        transactionsRef,
        where('merchantId', '==', merchant.id),
        where('collectedBy', '==', currentUserId),
        orderBy('timestamp', 'desc')
      );
    } else {
      // merchantOwner 可以看所有交易
      q = query(
        transactionsRef,
        where('merchantId', '==', merchant.id),
        orderBy('timestamp', 'desc')
      );
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const transactions = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // 只显示非 pending 的交易
          if (data.status !== 'pending') {
            transactions.push({
              id: doc.id,
              ...data
            });
          }
        });
        setAllTransactions(transactions);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to all transactions:', err);
        setError('加载交易记录失败');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [merchant?.id, organizationId, eventId, userRole, currentUserId]);

  // ============================================
  // ⭐ 4. 确认收款
  // ============================================
  const handleConfirmPayment = async (transactionId) => {
    try {
      const confirmPayment = httpsCallable(functions, 'confirmMerchantPayment');
      
      const result = await confirmPayment({
        organizationId,
        eventId,
        transactionId
      });

      if (result.data.success) {
        // 交易会自动从 pending 列表中移除（因为 onSnapshot）
        console.log('✅ 收款确认成功:', result.data);
      }
    } catch (error) {
      console.error('❌ 确认收款失败:', error);
      alert(`确认收款失败：${error.message}`);
    }
  };

  // ============================================
  // ⭐ 5. 取消交易
  // ============================================
  const handleCancelPayment = async (transactionId) => {
    const reason = prompt('请输入取消原因（可选）:');
    
    try {
      const cancelPayment = httpsCallable(functions, 'cancelMerchantPayment');
      
      const result = await cancelPayment({
        organizationId,
        eventId,
        transactionId,
        cancelReason: reason || undefined
      });

      if (result.data.success) {
        console.log('✅ 取消交易成功:', result.data);
      }
    } catch (error) {
      console.error('❌ 取消交易失败:', error);
      alert(`取消交易失败：${error.message}`);
    }
  };

  // ============================================
  // ⭐ 6. 退款（仅 merchantOwner）
  // ============================================
  const handleRefund = async (transactionId, refundReason) => {
    try {
      const refundPayment = httpsCallable(functions, 'refundMerchantPayment');
      
      const result = await refundPayment({
        organizationId,
        eventId,
        transactionId,
        refundReason
      });

      if (result.data.success) {
        alert('退款成功！');
        console.log('✅ 退款成功:', result.data);
      }
    } catch (error) {
      console.error('❌ 退款失败:', error);
      alert(`退款失败：${error.message}`);
    }
  };

  // ============================================
  // UI 渲染
  // ============================================

  if (loading && currentTab !== 'pending') {
    return (
      <div className="transactions-loading">
        <RefreshCw className="loading-spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="transactions-error">
        <AlertCircle className="error-icon" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="merchant-transactions-container">
      {/* Tabs Navigation */}
      <div className="transactions-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const count = 
            tab.id === 'pending' ? pendingPayments.length :
            tab.id === 'today' ? todayTransactions.length :
            allTransactions.length;

          return (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={`transactions-tab ${currentTab === tab.id ? 'active' : ''}`}
            >
              <Icon />
              <span className="tab-label">{tab.label}</span>
              {tab.id === 'pending' && count > 0 && (
                <span className="tab-badge">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="transactions-content">
        {/* ⭐ Pending Tab - 待收点数 */}
        {currentTab === 'pending' && (
          <div className="transactions-list">
            {pendingPayments.length === 0 ? (
              <div className="transactions-empty">
                <Bell className="empty-icon" />
                <p className="empty-title">暂无待收点数</p>
                <p className="empty-text">顾客扫码付款后会显示在这里</p>
              </div>
            ) : (
              <div className="pending-payments-grid">
                {pendingPayments.map((payment) => (
                  <PendingPaymentCard
                    key={payment.id}
                    payment={payment}
                    onConfirm={handleConfirmPayment}
                    onCancel={handleCancelPayment}
                    userRole={userRole}
                    loading={loading}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Today Tab - 今日交易 */}
        {currentTab === 'today' && (
          <div className="transactions-list">
            {todayTransactions.length === 0 ? (
              <div className="transactions-empty">
                <Calendar className="empty-icon" />
                <p className="empty-title">今日暂无交易</p>
                <p className="empty-text">今日的交易记录会显示在这里</p>
              </div>
            ) : (
              <div className="transactions-grid">
                {todayTransactions.map((transaction) => (
                  <TransactionCard
                    key={transaction.id}
                    transaction={transaction}
                    onRefund={handleRefund}
                    userRole={userRole}
                    currentUserId={currentUserId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* All Tab - 所有交易 */}
        {currentTab === 'all' && (
          <div className="transactions-list">
            {allTransactions.length === 0 ? (
              <div className="transactions-empty">
                <Receipt className="empty-icon" />
                <p className="empty-title">暂无交易记录</p>
                <p className="empty-text">所有交易记录会显示在这里</p>
              </div>
            ) : (
              <div className="transactions-grid">
                {allTransactions.map((transaction) => (
                  <TransactionCard
                    key={transaction.id}
                    transaction={transaction}
                    onRefund={handleRefund}
                    userRole={userRole}
                    currentUserId={currentUserId}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ⭐ 角色提示（仅 merchantAsist 显示）*/}
      {userRole === 'merchantAsist' && currentTab !== 'pending' && (
        <div className="transactions-role-notice">
          <AlertCircle className="notice-icon" />
          <p>您只能查看自己确认的交易记录</p>
        </div>
      )}
    </div>
  );
};

export default MerchantTransactions;
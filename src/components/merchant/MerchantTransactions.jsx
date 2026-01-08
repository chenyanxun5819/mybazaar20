import { useState, useEffect } from 'react';
import { Receipt, Search, Filter, ChevronDown, RefreshCw, Calendar } from 'lucide-react';
import { 
  getTransactionHistory,
  maskPhoneNumber,
  formatAmount,
  formatTransactionTime,
  getTransactionStatusDisplay
} from '../../services/transactionService';
import './MerchantTransactions.css';

/**
 * TransactionCard - 单个交易卡片（Mobile 优化）
 */
const TransactionCard = ({ transaction }) => {
  const statusInfo = getTransactionStatusDisplay(transaction.status);
  const StatusIcon = require('lucide-react')[statusInfo.icon];

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
        </div>
        <div className="transaction-card-amount">
          <span>{formatAmount(transaction.amount)}</span>
          <span>點</span>
        </div>
      </div>

      {/* 狀態標籤 */}
      <div className="transaction-card-footer">
        <span className={`transaction-status-badge ${statusInfo.bgColor} ${statusInfo.color}`}>
          <StatusIcon />
          {statusInfo.text}
        </span>
        <span className="transaction-card-id">
          #{transaction.id.substring(0, 8)}
        </span>
      </div>
    </div>
  );
};

/**
 * MerchantTransactions - 交易记录主组件
 */
const MerchantTransactions = ({ merchant, organizationId, eventId }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterBy, setFilterBy] = useState('all'); // 'all' | 'today' | 'week'
  const [showFilter, setShowFilter] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 加载交易记录
  const loadTransactions = async () => {
    if (!merchant?.id || !organizationId || !eventId) return;

    try {
      setLoading(true);
      setError(null);

      const data = await getTransactionHistory(
        organizationId,
        eventId,
        merchant.id,
        {
          limit: 50,
          filterBy: filterBy,
          status: 'completed' // 只显示完成的交易
        }
      );

      setTransactions(data);
    } catch (err) {
      console.error('Error loading transactions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载和筛选变化时重新加载
  useEffect(() => {
    loadTransactions();
  }, [merchant?.id, organizationId, eventId, filterBy]);

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

  if (loading) {
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
        <button onClick={loadTransactions}>
          <RefreshCw />
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="merchant-transactions-container">
      {/* Header: 统计和操作 */}
      <div className="merchant-transactions-header">
        <div className="merchant-transactions-summary">
          <div className="merchant-transactions-filter-info">
            <div>
              <p>筛选范围</p>
              <p>{filterOptions.find(f => f.value === filterBy)?.label}</p>
            </div>
          </div>
          <div className="merchant-transactions-total">
            <div>
              <p>总金额</p>
              <p>{formatAmount(totalAmount)}</p>
            </div>
          </div>
        </div>
        <div className="merchant-transactions-count">
          <Receipt />
          <span>共 {totalCount} 笔交易</span>
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
          onClick={loadTransactions}
          className="merchant-refresh-btn"
        >
          <RefreshCw />
        </button>
      </div>

      {/* 筛选选项 */}
      {showFilter && (
        <div className="merchant-filter-panel">
          <p>时间范围</p>
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
            <p>
              {searchTerm ? '没有符合搜索条件的交易' : '当您收到付款时，交易记录会显示在这里'}
            </p>
          </div>
        ) : (
          filteredTransactions.map((transaction) => (
            <TransactionCard key={transaction.id} transaction={transaction} />
          ))
        )}
      </div>

      {/* 加载更多（如果需要） */}
      {filteredTransactions.length >= 50 && (
        <div className="merchant-transactions-load-more">
          <button>加载更多</button>
        </div>
      )}
    </div>
  );
};

export default MerchantTransactions;

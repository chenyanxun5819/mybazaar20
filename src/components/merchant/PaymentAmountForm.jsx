import React, { useState, useEffect } from 'react';
import './PaymentAmountForm.css';

/**
 * PaymentAmountForm - 金额输入表单组件
 * 用于 RFID 支付页面的金额输入和确认
 * 
 * Props:
 * - amount: string - 当前金额
 * - onAmountChange: (amount: string) => void - 金额变化回调
 * - maxAmount: number - 最大可支付金额
 * - error: string | null - 错误信息
 * - onConfirm: () => void - 确认回调
 * - onBack: () => void - 返回回调
 * - loading: boolean - 加载状态
 */
const PaymentAmountForm = ({
  amount,
  onAmountChange,
  maxAmount = 0,
  error,
  onConfirm,
  onBack,
  loading = false
}) => {
  const [quickAmounts] = useState([10, 20, 50, 100, 200, 500]);

  // 处理金额输入
  const handleAmountInput = (e) => {
    const value = e.target.value;
    
    // 只允许数字
    if (value === '' || /^\d+$/.test(value)) {
      const numValue = value ? parseInt(value, 10) : 0;
      
      // 限制最大值
      if (numValue <= maxAmount) {
        onAmountChange(value);
      } else if (value === '') {
        onAmountChange('');
      }
    }
  };

  // 快速选择金额
  const handleQuickAmount = (quickAmount) => {
    if (quickAmount <= maxAmount) {
      onAmountChange(quickAmount.toString());
    }
  };

  // 验证是否可以提交
  const canSubmit = amount && parseInt(amount, 10) > 0 && parseInt(amount, 10) <= maxAmount && !loading;

  return (
    <div className="payment-form-container">
      <div className="form-section">
        {/* 金额输入区域 */}
        <div className="amount-input-section">
          <label htmlFor="paymentAmount" className="amount-label">
            支付金额
          </label>
          <div className="amount-input-wrapper">
            <input
              id="paymentAmount"
              type="number"
              value={amount}
              onChange={handleAmountInput}
              placeholder="0"
              className="amount-input"
              disabled={loading}
              autoFocus
              min="0"
              max={maxAmount}
            />
            <span className="amount-unit">点</span>
          </div>
          
          {/* 最大金额提示 */}
          <div className="amount-hint">
            最多可支付: <span className="max-amount">{maxAmount}</span> 点
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </div>

        {/* 快速选择按钮 */}
        <div className="quick-amounts-section">
          <label className="quick-amounts-label">快速选择</label>
          <div className="quick-amounts-grid">
            {quickAmounts.map(quickAmount => (
              <button
                key={quickAmount}
                type="button"
                onClick={() => handleQuickAmount(quickAmount)}
                className={`quick-amount-btn ${
                  amount === quickAmount.toString() ? 'active' : ''
                } ${quickAmount > maxAmount ? 'disabled' : ''}`}
                disabled={quickAmount > maxAmount || loading}
                title={quickAmount > maxAmount ? '金额超出余额' : ''}
              >
                {quickAmount}
              </button>
            ))}
          </div>
        </div>

        {/* 金额汇总 */}
        {amount && parseInt(amount, 10) > 0 && (
          <div className="amount-summary">
            <div className="summary-row">
              <span className="summary-label">支付金额:</span>
              <span className="summary-value">{amount} 点</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">剩余余额:</span>
              <span className="summary-value">
                {Math.max(0, maxAmount - parseInt(amount, 10))} 点
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="form-actions">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary"
          disabled={loading}
        >
          返回
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="btn-primary"
          disabled={!canSubmit}
        >
          {loading ? '处理中...' : '确认支付'}
        </button>
      </div>
    </div>
  );
};

export default PaymentAmountForm;

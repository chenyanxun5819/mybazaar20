/**
 * Transaction PIN Dialog Component
 * 交易密码输入对话框 - 用于验证敏感操作
 */

import React, { useState, useEffect, useRef } from 'react';
import './TransactionPinDialog.css';

const TransactionPinDialog = ({ submission, onConfirm, onCancel }) => {
  const [pin, setPin] = useState('');
  const [confirmationNote, setConfirmationNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinInputRef = useRef(null);

  // 自动聚焦到密码输入框
  useEffect(() => {
    if (pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, []);

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

  // 处理密码输入
  const handlePinChange = (e) => {
    const value = e.target.value.replace(/\D/g, ''); // 只允许数字
    if (value.length <= 6) {
      setPin(value);
      setError('');
    }
  };

  // 处理确认
  const handleConfirm = async () => {
    // 验证密码
    if (pin.length !== 6) {
      setError('请输入6位数字交易密码');
      return;
    }

    try {
      setLoading(true);
      await onConfirm(pin, confirmationNote);
    } catch (err) {
      setError(err.message || '确认失败，请重试');
      setLoading(false);
    }
  };

  // 处理键盘事件
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && pin.length === 6) {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="pin-dialog-overlay" onClick={onCancel}>
      <div className="pin-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 对话框头部 */}
        <div className="pin-dialog-header">
          <h3>🔐 接单确认收款</h3>
          <button className="close-button" onClick={onCancel}>✕</button>
        </div>

        {/* 对话框内容 */}
        <div className="pin-dialog-content">
          {/* 收款信息摘要 */}
          <div className="submission-summary">
            <div className="summary-row">
              <span className="summary-label">提交者：</span>
              <span className="summary-value">{submission.submitterName}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">角色：</span>
              <span className="summary-value">{submission.submitterRole}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">金额：</span>
              <span className="summary-value amount">{formatAmount(submission.amount)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">提交时间：</span>
              <span className="summary-value">{formatDateTime(submission.submittedAt)}</span>
            </div>
            {submission.note && (
              <div className="summary-row">
                <span className="summary-label">备注：</span>
                <span className="summary-value">{submission.note}</span>
              </div>
            )}
          </div>

          {/* 交易密码输入 */}
          <div className="pin-input-section">
            <label htmlFor="transactionPin" className="pin-label">
              <span className="label-icon">🔑</span>
              请输入交易密码
            </label>
            <input
              ref={pinInputRef}
              id="transactionPin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={handlePinChange}
              onKeyPress={handleKeyPress}
              placeholder="6位数字密码"
              className={`pin-input ${error ? 'error' : ''}`}
              disabled={loading}
              maxLength={6}
            />
            <div className="pin-dots">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
              ))}
            </div>
            {error && <p className="error-message">{error}</p>}
          </div>

          {/* 确认备注 */}
          <div className="note-section">
            <label htmlFor="confirmationNote" className="note-label">
              确认备注（可选）
            </label>
            <textarea
              id="confirmationNote"
              value={confirmationNote}
              onChange={(e) => setConfirmationNote(e.target.value)}
              placeholder="例如：已核对无误，收到50张100元纸钞"
              className="note-textarea"
              disabled={loading}
              maxLength={200}
              rows={3}
            />
            <div className="char-count">
              {confirmationNote.length} / 200
            </div>
          </div>

          {/* 安全提示 */}
          <div className="security-tip">
            <span className="tip-icon">⚠️</span>
            <span className="tip-text">
              请确认已收到现金并当面核对金额后再点击确认。此操作不可撤销。
            </span>
          </div>
        </div>

        {/* 对话框按钮 */}
        <div className="pin-dialog-footer">
          <button 
            className="cancel-btn" 
            onClick={onCancel}
            disabled={loading}
          >
            取消
          </button>
          <button 
            className="confirm-btn" 
            onClick={handleConfirm}
            disabled={loading || pin.length !== 6}
          >
            {loading ? '确认中...' : '✅ 确认收款'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionPinDialog;
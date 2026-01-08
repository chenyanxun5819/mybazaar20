/**
 * Transaction PIN Dialog Component
 * 通用交易密码输入对话框 - 用于验证敏感操作
 */

import React, { useState, useEffect, useRef } from 'react';
import './TransactionPinDialog.css';

const TransactionPinDialog = ({ 
  title = '🔐 交易密码验证',
  message,
  onConfirm, 
  onCancel,
  confirmButtonText = '✅ 确认',
  allowNote = false,
  noteLabel = '备注（可选）',
  notePlaceholder = '请输入备注信息...'
}) => {
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinInputRef = useRef(null);

  // 自动聚焦到密码输入框
  useEffect(() => {
    if (pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, []);

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
      await onConfirm(pin, note);
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
          <h3>{title}</h3>
          <button className="close-button" onClick={onCancel}>✕</button>
        </div>

        {/* 对话框内容 */}
        <div className="pin-dialog-content">
          {/* 消息提示 */}
          {message && (
            <div className="message-box">
              <p className="message-text">{message}</p>
            </div>
          )}

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

          {/* 备注输入（可选） */}
          {allowNote && (
            <div className="note-section">
              <label htmlFor="confirmationNote" className="note-label">
                {noteLabel}
              </label>
              <textarea
                id="confirmationNote"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={notePlaceholder}
                className="note-textarea"
                disabled={loading}
                maxLength={200}
                rows={3}
              />
              <div className="char-count">
                {note.length} / 200
              </div>
            </div>
          )}

          {/* 安全提示 */}
          <div className="security-tip">
            <span className="tip-icon">⚠️</span>
            <span className="tip-text">
              请妥善保管您的交易密码。此操作不可撤销。
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
            {loading ? '确认中...' : confirmButtonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionPinDialog;
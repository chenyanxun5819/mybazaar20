/**
 * PinInput.jsx
 * 通用交易密码输入组件
 * 
 * 使用场景：
 * - Seller 卖点数给 Customer 时
 * - Customer 支付给 Merchant 时
 * - Customer 转让点数给其他 Customer 时
 * 
 * Props:
 * - onSubmit: (pin) => Promise<void> - PIN 提交回调
 * - onCancel: () => void - 取消回调
 * - title: string - 弹窗标题
 * - description: string - 描述文字
 * - loading: boolean - 加载状态
 */

import React, { useState, useRef, useEffect } from 'react';
import './PinInput.css';

const PinInput = ({ onSubmit, onCancel, title, description, loading = false }) => {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const inputRefs = useRef([]);

  // ========== 自动聚焦第一个输入框 ==========
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  // ========== 处理输入 ==========
  const handleChange = (index, value) => {
    // 只允许数字
    if (!/^\d*$/.test(value)) return;

    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    setError('');

    // 自动跳到下一个输入框
    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  // ========== 处理键盘事件 ==========
  const handleKeyDown = (index, e) => {
    // Backspace: 删除当前并跳到上一个
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }

    // Enter: 提交
    if (e.key === 'Enter') {
      handleSubmit();
    }

    // 左箭头
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1].focus();
    }

    // 右箭头
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  // ========== 处理粘贴 ==========
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    
    // 只允许6位数字
    if (/^\d{6}$/.test(pastedData)) {
      const newPin = pastedData.split('');
      setPin(newPin);
      inputRefs.current[5].focus(); // 聚焦到最后一个
    }
  };

  // ========== 提交 PIN ==========
  const handleSubmit = async () => {
    const pinString = pin.join('');

    // 验证 PIN 完整性
    if (pinString.length !== 6) {
      setError('请输入完整的6位交易密码');
      return;
    }

    // 调用父组件的提交函数
    try {
      await onSubmit(pinString);
    } catch (error) {
      setError(error.message || '验证失败，请重试');
    }
  };

  // ========== 清除 PIN ==========
  const handleClear = () => {
    setPin(['', '', '', '', '', '']);
    setError('');
    inputRefs.current[0].focus();
  };

  // ========== 渲染 ==========
  return (
    <div className="pin-input-overlay" onClick={onCancel}>
      <div className="pin-input-modal" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="pin-modal-header">
          <h2>{title || '请输入交易密码'}</h2>
          {description && <p>{description}</p>}
        </div>

        {/* PIN 输入框 */}
        <div className="pin-boxes-container">
          {pin.map((digit, index) => (
            <input
              key={index}
              ref={(el) => (inputRefs.current[index] = el)}
              type="password"
              inputMode="numeric"
              maxLength="1"
              value={digit}
              onChange={(e) => handleChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={index === 0 ? handlePaste : undefined}
              className="pin-box"
              disabled={loading}
            />
          ))}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="pin-error-message">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="pin-actions">
          <button 
            onClick={handleClear}
            className="btn-clear"
            disabled={loading}
          >
            清除
          </button>
          <button 
            onClick={onCancel}
            className="btn-cancel"
            disabled={loading}
          >
            取消
          </button>
          <button 
            onClick={handleSubmit}
            className="btn-submit"
            disabled={loading || pin.some(d => !d)}
          >
            {loading ? '验证中...' : '确认'}
          </button>
        </div>

        {/* 提示 */}
        <div className="pin-hint">
          <p>💡 输入6位数字交易密码</p>
          <p>连续输错5次将锁定1小时</p>
        </div>
      </div>
    </div>
  );
};

export default PinInput;


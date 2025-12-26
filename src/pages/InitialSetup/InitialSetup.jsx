/**
 * InitialSetup.jsx
 * 首次登录初始化设置页面
 * 
 * 功能：
 * - Step 1: 修改登录密码（从默认密码改为新密码）
 * - Step 2: 设置交易密码（6位数字）
 * 
 * 使用场景：
 * - 批量导入的用户首次登录时
 * - isFirstLogin === true 或 hasDefaultPassword === true
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import './InitialSetup.css';

const InitialSetup = () => {
  const navigate = useNavigate();
  const auth = getAuth();
  const functions = getFunctions();

  // ========== 状态管理 ==========
  const [currentStep, setCurrentStep] = useState(1); // 1 或 2
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Step 1: 修改密码
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Step 2: 设置 PIN
  const [pinData, setPinData] = useState({
    transactionPin: '',
    confirmPin: ''
  });

  // 从 localStorage 获取用户信息（登录时保存的）
  const [userInfo, setUserInfo] = useState(null);

  // ========== 初始化 ==========
  useEffect(() => {
    // 获取临时存储的用户信息
    const tempUserData = localStorage.getItem('tempUserData');
    
    if (!tempUserData) {
      // 如果没有临时数据，说明不是从登录页来的，重定向到登录
      navigate('/login');
      return;
    }

    try {
      const userData = JSON.parse(tempUserData);
      setUserInfo(userData);
    } catch (error) {
      console.error('解析用户数据失败:', error);
      navigate('/login');
    }
  }, [navigate]);

  // ========== 密码验证 ==========
  const validatePassword = (password) => {
    if (!password) {
      return '密码不能为空';
    }
    if (password.length < 8) {
      return '密码至少需要8个字符';
    }
    if (!/[a-zA-Z]/.test(password)) {
      return '密码必须包含字母';
    }
    if (!/[0-9]/.test(password)) {
      return '密码必须包含数字';
    }
    return null;
  };

  // ========== PIN 验证 ==========
  const validatePin = (pin) => {
    if (!pin) {
      return '交易密码不能为空';
    }
    if (!/^\d{6}$/.test(pin)) {
      return '交易密码必须是6位数字';
    }

    // 检查简单密码
    const weakPins = [
      '000000', '111111', '222222', '333333', '444444',
      '555555', '666666', '777777', '888888', '999999',
      '123456', '654321', '123123'
    ];

    if (weakPins.includes(pin)) {
      return '请使用更安全的密码组合';
    }

    // 检查连续数字
    const digits = pin.split('').map(Number);
    let isAscending = true;
    let isDescending = true;
    
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] !== digits[i - 1] + 1) isAscending = false;
      if (digits[i] !== digits[i - 1] - 1) isDescending = false;
    }

    if (isAscending || isDescending) {
      return '请不要使用连续数字';
    }

    return null;
  };

  // ========== Step 1: 修改密码 ==========
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 验证新密码
      const passwordError = validatePassword(passwordData.newPassword);
      if (passwordError) {
        setError(passwordError);
        setLoading(false);
        return;
      }

      // 验证确认密码
      if (passwordData.newPassword !== passwordData.confirmPassword) {
        setError('两次输入的密码不一致');
        setLoading(false);
        return;
      }

      // 检查新密码不能与旧密码相同
      if (passwordData.oldPassword === passwordData.newPassword) {
        setError('新密码不能与旧密码相同');
        setLoading(false);
        return;
      }

      // 调用 Cloud Function
      const changePassword = httpsCallable(functions, 'changeLoginPassword');
      const result = await changePassword({
        userId: auth.currentUser.uid,
        organizationId: userInfo.organizationId,
        eventId: userInfo.eventId,
        oldPassword: passwordData.oldPassword,
        newPassword: passwordData.newPassword
      });

      console.log('密码修改成功:', result.data);

      // 进入 Step 2
      setCurrentStep(2);
      setError('');

    } catch (error) {
      console.error('修改密码失败:', error);
      
      if (error.code === 'functions/permission-denied') {
        setError('旧密码错误，请重新输入');
      } else if (error.code === 'functions/invalid-argument') {
        setError(error.message);
      } else {
        setError('修改密码失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  // ========== Step 2: 设置交易密码 ==========
  const handlePinSetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 验证 PIN
      const pinError = validatePin(pinData.transactionPin);
      if (pinError) {
        setError(pinError);
        setLoading(false);
        return;
      }

      // 验证确认 PIN
      if (pinData.transactionPin !== pinData.confirmPin) {
        setError('两次输入的交易密码不一致');
        setLoading(false);
        return;
      }

      // 调用 Cloud Function
      const setupPin = httpsCallable(functions, 'setupTransactionPin');
      const result = await setupPin({
        userId: auth.currentUser.uid,
        organizationId: userInfo.organizationId,
        eventId: userInfo.eventId,
        transactionPin: pinData.transactionPin
      });

      console.log('交易密码设置成功:', result.data);

      // 清除临时数据
      localStorage.removeItem('tempUserData');

      // 跳转到对应的 Dashboard
      navigateToDashboard();

    } catch (error) {
      console.error('设置交易密码失败:', error);
      
      if (error.code === 'functions/invalid-argument') {
        setError(error.message);
      } else {
        setError('设置交易密码失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  // ========== 跳转到 Dashboard ==========
  const navigateToDashboard = () => {
    if (!userInfo || !userInfo.roles) {
      navigate('/login');
      return;
    }

    const roles = userInfo.roles;

    // 根据角色优先级跳转
    if (roles.includes('customer')) {
      navigate('/customer-dashboard');
    } else if (roles.includes('seller')) {
      navigate('/seller-dashboard');
    } else if (roles.includes('merchant')) {
      navigate('/merchant-dashboard');
    } else if (roles.includes('sellerManager')) {
      navigate('/seller-manager-dashboard');
    } else if (roles.includes('cashier')) {
      navigate('/cashier-dashboard');
    } else if (roles.includes('eventManager')) {
      navigate('/event-manager-dashboard');
    } else {
      navigate('/login');
    }
  };

  // ========== 如果还在加载用户信息 ==========
  if (!userInfo) {
    return (
      <div className="initial-setup-container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  // ========== 渲染 ==========
  return (
    <div className="initial-setup-container">
      <div className="initial-setup-card">
        {/* 头部 */}
        <div className="setup-header">
          <h1>初始化设置</h1>
          <p className="welcome-text">欢迎，{userInfo.displayName || '用户'}</p>
        </div>

        {/* 进度指示器 */}
        <div className="progress-indicator">
          <div className={`step ${currentStep >= 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}>
            <div className="step-circle">
              {currentStep > 1 ? '✓' : '1'}
            </div>
            <div className="step-label">修改密码</div>
          </div>
          <div className="step-line"></div>
          <div className={`step ${currentStep >= 2 ? 'active' : ''}`}>
            <div className="step-circle">2</div>
            <div className="step-label">设置交易密码</div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}

        {/* Step 1: 修改密码 */}
        {currentStep === 1 && (
          <form onSubmit={handlePasswordChange} className="setup-form">
            <div className="form-section">
              <h2>Step 1: 修改登录密码</h2>
              <p className="section-description">
                请修改您的默认密码，以确保账户安全
              </p>

              <div className="form-group">
                <label htmlFor="oldPassword">旧密码</label>
                <input
                  type="password"
                  id="oldPassword"
                  value={passwordData.oldPassword}
                  onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})}
                  placeholder="请输入默认密码"
                  required
                  disabled={loading}
                />
                <small className="field-hint">
                  默认密码通常为：组织代码 + 活动代码
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="newPassword">新密码</label>
                <input
                  type="password"
                  id="newPassword"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                  placeholder="至少8个字符，包含字母和数字"
                  required
                  disabled={loading}
                />
                <small className="field-hint">
                  ✓ 至少8个字符 ✓ 包含字母 ✓ 包含数字
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">确认新密码</label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                  placeholder="请再次输入新密码"
                  required
                  disabled={loading}
                />
              </div>

              <button 
                type="submit" 
                className="btn-primary"
                disabled={loading}
              >
                {loading ? '处理中...' : '下一步'}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: 设置交易密码 */}
        {currentStep === 2 && (
          <form onSubmit={handlePinSetup} className="setup-form">
            <div className="form-section">
              <h2>Step 2: 设置交易密码</h2>
              <p className="section-description">
                交易密码用于点数转账和支付验证
              </p>

              <div className="form-group">
                <label htmlFor="transactionPin">交易密码</label>
                <input
                  type="password"
                  id="transactionPin"
                  value={pinData.transactionPin}
                  onChange={(e) => {
                    // 只允许输入数字，最多6位
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setPinData({...pinData, transactionPin: value});
                  }}
                  placeholder="请输入6位数字"
                  maxLength="6"
                  required
                  disabled={loading}
                  className="pin-input"
                />
                <small className="field-hint">
                  6位数字，不要使用简单密码（如 123456）
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="confirmPin">确认交易密码</label>
                <input
                  type="password"
                  id="confirmPin"
                  value={pinData.confirmPin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setPinData({...pinData, confirmPin: value});
                  }}
                  placeholder="请再次输入6位数字"
                  maxLength="6"
                  required
                  disabled={loading}
                  className="pin-input"
                />
              </div>

              <div className="security-tips">
                <h3>💡 安全提示</h3>
                <ul>
                  <li>交易密码用于每次转账时验证身份</li>
                  <li>请勿使用简单密码（如 000000, 123456）</li>
                  <li>请勿与他人分享交易密码</li>
                  <li>连续输错5次将锁定1小时</li>
                </ul>
              </div>

              <button 
                type="submit" 
                className="btn-primary"
                disabled={loading}
              >
                {loading ? '处理中...' : '完成设置'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default InitialSetup;

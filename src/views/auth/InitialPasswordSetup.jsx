import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { auth, functions } from '../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import './InitialPasswordSetup.css';

/**
 * 初始密码设置组件
 */
const InitialPasswordSetup = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgEventCode } = useParams();
  const { updateUserProfile, refreshProfile } = useAuth();
  const [orgCode, eventCode] = orgEventCode?.split('-') || ['', ''];

  // 当前步骤 (1: 登录密码, 2: 交易密码, 3: 完成)
  // 🔧 修复：所有用户都需要设置交易密码（包括 eventManager）
  const [step, setStep] = useState(1);
  const [needsTransactionPin, setNeedsTransactionPin] = useState(true);

  // 用户信息（从 location.state 或 sessionStorage 获取）
  const [userInfo, setUserInfo] = useState(null);

  // Step 1: 登录密码
  const [loginPasswordData, setLoginPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Step 2: 交易密码
  const [transactionPinData, setTransactionPinData] = useState({
    pin: '',
    confirmPin: ''
  });

  // 状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ========== 初始化 ==========
  useEffect(() => {
    // 从 location.state 或 sessionStorage 获取用户信息
    const stateUserInfo = location.state?.userInfo;
    const sessionUserInfo = JSON.parse(sessionStorage.getItem('passwordSetupPending') || 'null');

    const info = stateUserInfo || sessionUserInfo;

    if (!info) {
      setError('缺少用户信息，请重新登录');
      setTimeout(() => {
        navigate(`/login/${orgEventCode}`, { replace: true });
      }, 2000);
      return;
    }

    setUserInfo(info);

    // 🔧 修复：所有用户都需要设置交易密码（包括 eventManager）
    // 交易密码用于确认所有支付和转账操作
    setNeedsTransactionPin(true);

    // 清理 sessionStorage
    if (sessionUserInfo) {
      sessionStorage.removeItem('passwordSetupPending');
    }
  }, [location.state, orgEventCode, navigate]);

  // ========== Step 1: 修改登录密码 ==========
  const handleChangeLoginPassword = async (e) => {
    e.preventDefault();
    setError('');

    // 验证表单
    if (!loginPasswordData.oldPassword || !loginPasswordData.newPassword || !loginPasswordData.confirmPassword) {
      setError('请填写所有字段');
      return;
    }

    if (loginPasswordData.newPassword.length < 8) {
      setError('新密码至少需要 8 个字符');
      return;
    }

    if (!/[a-zA-Z]/.test(loginPasswordData.newPassword) || !/\d/.test(loginPasswordData.newPassword)) {
      setError('新密码必须包含英文字母和数字');
      return;
    }

    if (loginPasswordData.newPassword !== loginPasswordData.confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    if (loginPasswordData.oldPassword === loginPasswordData.newPassword) {
      setError('新密码不能与旧密码相同');
      return;
    }

    setLoading(true);

    try {
      console.log('[InitialPasswordSetup] 正在修改登录密码...');

      const changePassword = httpsCallable(functions, 'changeLoginPassword');
      const result = await changePassword({
        userId: userInfo.userId,
        organizationId: userInfo.organizationId,
        eventId: userInfo.eventId,
        oldPassword: loginPasswordData.oldPassword,
        newPassword: loginPasswordData.newPassword
      });

      console.log('[InitialPasswordSetup] 登录密码修改成功:', result.data);

      // 🔧 修复：如果不需要设置交易密码，直接进入完成步骤
      if (!needsTransactionPin) {
        setStep(3);
        setTimeout(() => {
          navigateToDashboard();
        }, 3000);
        return;
      }

      // 进入 Step 2
      setStep(2);
      setError('');
      setLoginPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });

    } catch (error) {
      console.error('[InitialPasswordSetup] 修改登录密码失败:', error);

      const errorMessage = error.message || '修改密码失败，请重试';

      if (errorMessage.includes('旧密码') || errorMessage.includes('验证失败')) {
        setError('旧密码错误，请检查');
      } else if (errorMessage.includes('格式') || errorMessage.includes('长度')) {
        setError('新密码格式不正确');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // ========== Step 2: 设置交易密码 ==========
  const handleSetupTransactionPin = async (e) => {
    e.preventDefault();
    setError('');

    // 验证表单
    if (!transactionPinData.pin || !transactionPinData.confirmPin) {
      setError('请填写所有字段');
      return;
    }

    if (transactionPinData.pin.length !== 6) {
      setError('交易密码必须是 6 位数字');
      return;
    }

    if (!/^\d{6}$/.test(transactionPinData.pin)) {
      setError('交易密码只能包含数字');
      return;
    }

    if (transactionPinData.pin !== transactionPinData.confirmPin) {
      setError('两次输入的交易密码不一致');
      return;
    }

    setLoading(true);

    try {
      console.log('[InitialPasswordSetup] 正在设置交易密码...');

      const setupPin = httpsCallable(functions, 'setupTransactionPin');
      const result = await setupPin({
        userId: userInfo.userId,
        organizationId: userInfo.organizationId,
        eventId: userInfo.eventId,
        transactionPin: transactionPinData.pin
      });

      console.log('[InitialPasswordSetup] 交易密码设置成功:', result.data);

      // 🔥 关键修复：手动刷新 AuthContext 中的 userProfile
      // 这样跳转到 Dashboard 时，userProfile.isFirstLogin 才会是 false，且能拿到完整的 seller/merchant 统计数据
      console.log('[InitialPasswordSetup] 正在刷新用户资料...');
      const updatedProfile = await refreshProfile();

      // 更新本地 userInfo 副本，确保 navigateToDashboard 使用最新角色
      if (updatedProfile) {
        setUserInfo(prev => ({
          ...prev,
          ...updatedProfile
        }));
      }

      // 进入 Step 3（完成）
      setStep(3);
      setError('');
      setTransactionPinData({ pin: '', confirmPin: '' });

      // 🔐 关键修复：强制刷新 idToken（获取最新 custom claims）
      try {
        if (auth.currentUser) {
          console.log('[InitialPasswordSetup] 强制刷新 idToken...');
          await auth.currentUser.getIdToken(true);
          console.log('[InitialPasswordSetup] idToken 刷新成功');
        }
      } catch (tokenErr) {
        console.warn('[InitialPasswordSetup] idToken 刷新失败（非关键）:', tokenErr);
        // 继续进行，不中断流程
      }

      // 3秒后自动跳转到 Dashboard
      setTimeout(() => {
        navigateToDashboard();
      }, 3000);

    } catch (error) {
      console.error('[InitialPasswordSetup] 设置交易密码失败:', error);

      const errorMessage = error.message || '设置交易密码失败，请重试';

      if (errorMessage.includes('格式') || errorMessage.includes('位数')) {
        setError('交易密码格式不正确（必须是6位数字）');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // ========== 跳转到 Dashboard ==========
  const navigateToDashboard = () => {
    if (!userInfo || !userInfo.roles || userInfo.roles.length === 0) {
      console.error('[InitialPasswordSetup] 缺少角色信息');
      navigate(`/login/${orgEventCode}`, { replace: true });
      return;
    }

    // 根据设备类型和角色优先级确定 Dashboard
    const isMobile = window.innerWidth < 768;
    const roles = userInfo.roles;

    let dashboardPath = '/';

    if (isMobile) {
      // Mobile 优先级: seller > merchantOwner/merchantAsist > customer
      if (roles.includes('seller')) {
        dashboardPath = `/seller/${orgEventCode}/dashboard`;
      } else if (roles.includes('merchantOwner') || roles.includes('merchantAsist')) {
        dashboardPath = `/merchant/${orgEventCode}/dashboard`;
      } else if (roles.includes('customer')) {
        dashboardPath = `/customer/${orgEventCode}/dashboard`;
      }
    } else {
      // Desktop 优先级: eventManager > cashier > sellerManager > merchantManager > customerManager
      if (roles.includes('eventManager')) {
        dashboardPath = `/event-manager/${orgEventCode}/dashboard`;
      } else if (roles.includes('cashier')) {
        dashboardPath = `/cashier/${orgEventCode}/dashboard`;
      } else if (roles.includes('sellerManager')) {
        dashboardPath = `/seller-manager/${orgEventCode}/dashboard`;
      } else if (roles.includes('merchantManager')) {
        dashboardPath = `/merchant-manager/${orgEventCode}/dashboard`;
      } else if (roles.includes('customerManager')) {
        dashboardPath = `/customer-manager/${orgEventCode}/dashboard`;
      } else if (roles.includes('seller')) {
        dashboardPath = `/seller/${orgEventCode}/dashboard`;
      } else if (roles.includes('merchantOwner') || roles.includes('merchantAsist')) {
        dashboardPath = `/merchant/${orgEventCode}/dashboard`;
      } else if (roles.includes('customer')) {
        dashboardPath = `/customer/${orgEventCode}/dashboard`;
      }
    }

    console.log('[InitialPasswordSetup] 跳转到:', dashboardPath);
    
    // ⭐ 更新 AuthContext 中的用户信息，标记已完成设置
    if (updateUserProfile) {
      updateUserProfile({
        ...userInfo,
        basicInfo: {
          ...userInfo.basicInfo,
          hasDefaultPassword: false,
          isFirstLogin: false,
          hasTransactionPin: true
        }
      });
    }

    navigate(dashboardPath, { replace: true });
  };

  // ========== 渲染 ==========

  if (!userInfo) {
    return (
      <div className="password-setup-container">
        <div className="password-setup-card">
          <div className="loading-spinner">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="password-setup-container">
      <div className="password-setup-card">
        {/* Logo 和标题 */}
        <div className="setup-header">
          <div className="setup-logo">🔐</div>
          <h1 className="setup-title">设置您的密码</h1>
          <p className="setup-subtitle">
            {needsTransactionPin ? '首次登录需要设置新密码和交易密码' : '首次登录需要设置新密码'}
          </p>
        </div>

        {/* 步骤指示器 */}
        <div className="steps-indicator">
          <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
            <div className="step-number">1</div>
            <div className="step-label">登录密码</div>
          </div>
          {needsTransactionPin && (
            <>
              <div className="step-divider"></div>
              <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
                <div className="step-number">2</div>
                <div className="step-label">交易密码</div>
              </div>
            </>
          )}
          <div className="step-divider"></div>
          <div className={`step ${step >= (needsTransactionPin ? 3 : 2) ? 'active' : ''}`}>
            <div className="step-number">{needsTransactionPin ? 3 : 2}</div>
            <div className="step-label">完成</div>
          </div>
        </div>

        {/* Step 1: 修改登录密码 */}
        {step === 1 && (
          <form onSubmit={handleChangeLoginPassword} className="setup-form">
            <div className="form-section">
              <h2 className="section-title">步骤 1: 设置登录密码</h2>
              <p className="section-description">
                请输入您收到的初始密码，然后设置新的登录密码
              </p>

              <div className="form-group">
                <label className="form-label">初始密码</label>
                <input
                  type="password"
                  className="form-input"
                  value={loginPasswordData.oldPassword}
                  onChange={(e) => setLoginPasswordData(prev => ({
                    ...prev,
                    oldPassword: e.target.value
                  }))}
                  placeholder="输入您收到的初始密码"
                  disabled={loading}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">新密码</label>
                <input
                  type="password"
                  className="form-input"
                  value={loginPasswordData.newPassword}
                  onChange={(e) => setLoginPasswordData(prev => ({
                    ...prev,
                    newPassword: e.target.value
                  }))}
                  placeholder="至少 8 个字符，包含字母和数字"
                  disabled={loading}
                  required
                />
                <div className="input-hint">
                  密码必须至少 8 个字符，包含英文字母和数字
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">确认新密码</label>
                <input
                  type="password"
                  className="form-input"
                  value={loginPasswordData.confirmPassword}
                  onChange={(e) => setLoginPasswordData(prev => ({
                    ...prev,
                    confirmPassword: e.target.value
                  }))}
                  placeholder="再次输入新密码"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              className="submit-button"
              disabled={loading}
            >
              {loading ? '处理中...' : (needsTransactionPin ? '下一步' : '完成')}
            </button>
          </form>
        )}

        {/* Step 2: 设置交易密码 */}
        {step === 2 && needsTransactionPin && (
          <form onSubmit={handleSetupTransactionPin} className="setup-form">
            <div className="form-section">
              <h2 className="section-title">步骤 2: 设置交易密码</h2>
              <p className="section-description">
                交易密码用于确认支付和转账操作，请设置 6 位数字密码
              </p>

              <div className="form-group">
                <label className="form-label">交易密码</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength="6"
                  className="form-input pin-input"
                  value={transactionPinData.pin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setTransactionPinData(prev => ({
                      ...prev,
                      pin: value
                    }));
                  }}
                  placeholder="输入 6 位数字"
                  disabled={loading}
                  required
                />
                <div className="input-hint">
                  请输入 6 位数字作为交易密码
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">确认交易密码</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength="6"
                  className="form-input pin-input"
                  value={transactionPinData.confirmPin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setTransactionPinData(prev => ({
                      ...prev,
                      confirmPin: value
                    }));
                  }}
                  placeholder="再次输入 6 位数字"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              className="submit-button"
              disabled={loading}
            >
              {loading ? '处理中...' : '完成设置'}
            </button>
          </form>
        )}

        {/* Step 3: 完成 */}
        {step === 3 && (
          <div className="completion-section">
            <div className="success-icon">✅</div>
            <h2 className="success-title">设置完成！</h2>
            <p className="success-message">
              您的登录密码和交易密码已设置成功
            </p>
            <p className="redirect-message">
              正在跳转到您的 Dashboard...
            </p>
            <div className="loading-spinner">
              <div className="spinner"></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InitialPasswordSetup;

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { safeFetch } from '../../services/safeFetch';
import OTPInput from '../../components/OTPInput';

/**
 * Customer点数转让页面
 * 
 * 流程：
 * 1. 输入接收方手机号
 * 2. 查询接收方信息（脱敏显示）
 * 3. 输入转让金额
 * 4. 确认转让（如需OTP，发送验证码）
 * 5. 输入OTP（如果需要）
 * 6. 执行转让
 */
const CustomerTransfer = () => {
  const navigate = useNavigate();
  
  // 页面状态
  const [step, setStep] = useState('input'); // input | confirm | otp | processing | success
  
  // 用户数据
  const [customerData, setCustomerData] = useState(null);
  
  // 接收方数据
  const [recipientData, setRecipientData] = useState(null);
  const [recipientPhone, setRecipientPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  
  // 转让数据
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  
  // OTP数据
  const [otpSessionId, setOtpSessionId] = useState(null);
  const [otpExpiresIn, setOtpExpiresIn] = useState(300);
  const [otpRequired, setOtpRequired] = useState(false);
  
  // 加载状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadCustomerData();
  }, []);

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

      const customerRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', user.uid
      );

      const customerSnap = await getDoc(customerRef);
      if (customerSnap.exists()) {
        setCustomerData({
          ...customerSnap.data(),
          organizationId,
          eventId,
          userId: user.uid
        });
      }
    } catch (error) {
      console.error('[CustomerTransfer] 加载Customer数据失败:', error);
      setError('加载失败：' + error.message);
    }
  };

  // 标准化手机号
  const normalizePhoneNumber = (phone) => {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    
    if (cleaned.startsWith('+60')) {
      return cleaned;
    } else if (cleaned.startsWith('60')) {
      return '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
      return '+60' + cleaned.substring(1);
    } else if (cleaned.startsWith('1')) {
      return '+60' + cleaned;
    }
    
    return '+60' + cleaned;
  };

  // 脱敏显示手机号
  const maskPhoneNumber = (phone) => {
    if (!phone) return '';
    const normalized = phone.replace(/\D/g, '');
    if (normalized.length >= 10) {
      const last4 = normalized.slice(-4);
      const masked = normalized.slice(0, -4).replace(/\d/g, '*');
      return masked + last4;
    }
    return phone;
  };

  // 查询接收方
  const handleSearchRecipient = async () => {
    setPhoneError('');
    setError(null);

    if (!recipientPhone) {
      setPhoneError('请输入接收方手机号');
      return;
    }

    // 验证手机号格式
    const phoneRegex = /^(\+?60|0)?1\d{8,9}$/;
    if (!phoneRegex.test(recipientPhone.replace(/[\s\-]/g, ''))) {
      setPhoneError('手机号格式不正确');
      return;
    }

    // 检查是否是自己
    const normalizedPhone = normalizePhoneNumber(recipientPhone);
    if (normalizedPhone === customerData.identityInfo.phoneNumber) {
      setPhoneError('不能转给自己');
      return;
    }

    setLoading(true);

    try {
      // 查询接收方
      const usersRef = collection(
        db,
        'organizations', customerData.organizationId,
        'events', customerData.eventId,
        'users'
      );

      // 生成手机号变体
      const variants = [
        recipientPhone,
        normalizedPhone,
        recipientPhone.replace(/^0/, '+60'),
        recipientPhone.replace(/^\+60/, '0')
      ];

      let recipientDoc = null;

      for (const variant of variants) {
        const q = query(
          usersRef,
          where('identityInfo.phoneNumber', '==', variant),
          where('roles', 'array-contains', 'customer')
        );

        const querySnap = await getDocs(q);

        if (!querySnap.empty) {
          recipientDoc = querySnap.docs[0];
          break;
        }
      }

      if (!recipientDoc) {
        setPhoneError('该手机号未注册或不是Customer');
        return;
      }

      const recipient = recipientDoc.data();

      setRecipientData({
        ...recipient,
        userId: recipientDoc.id
      });

      setStep('confirm');

    } catch (error) {
      console.error('[CustomerTransfer] 查询接收方失败:', error);
      setError('查询失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 验证金额
  const validateAmount = () => {
    setAmountError('');

    if (!amount || parseFloat(amount) <= 0) {
      setAmountError('请输入有效金额');
      return false;
    }

    const numAmount = parseFloat(amount);
    const availablePoints = customerData?.customer?.pointsAccount?.availablePoints || 0;

    if (numAmount > availablePoints) {
      setAmountError(`余额不足。当前余额：${availablePoints}点`);
      return false;
    }

    // 最小转让金额
    if (numAmount < 1) {
      setAmountError('转让金额不能少于1点');
      return false;
    }

    return true;
  };

  // 确认转让（检查是否需要OTP）
  const handleConfirmTransfer = async () => {
    if (!validateAmount()) return;

    setLoading(true);
    setError(null);

    try {
      // 调用 sendOtpHttp 检查是否需要 OTP
      const response = await safeFetch('/api/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: customerData.identityInfo.phoneNumber,
          userId: customerData.userId,
          scenario: 'customerTransfer',
          scenarioData: {
            amount: parseFloat(amount),
            recipientName: recipientData.identityInfo.displayName,
            recipientPhone: maskPhoneNumber(recipientData.identityInfo.phoneNumber)
          }
        })
      });

      const result = await response.json();
      console.log('[CustomerTransfer] sendOTP结果:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || '发送 OTP 失败');
      }

      if (result.otpRequired) {
        // 需要OTP验证
        setOtpRequired(true);
        setOtpSessionId(result.sessionId);
        setOtpExpiresIn(result.expiresIn || 300);
        setStep('otp');
      } else {
        // 不需要OTP，直接转让
        setOtpRequired(false);
        await executeTransfer(null);
      }

    } catch (error) {
      console.error('[CustomerTransfer] 确认转让失败:', error);
      setError(error.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  // OTP验证完成
  const handleOTPComplete = async (otp) => {
    setLoading(true);
    setError(null);
    try {
      // 验证OTP（HTTP）
      const resp = await safeFetch('/api/verifyOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: otpSessionId, otp })
      });
      const result = await resp.json();
      console.log('[CustomerTransfer] OTP验证結果:', result);
      if (resp.ok && result.success) {
        // OTP验证成功，执行转让
        await executeTransfer(otpSessionId);
      } else {
        throw new Error('OTP验证失败');
      }

    } catch (error) {
      console.error('[CustomerTransfer] OTP验证失败:', error);
      setError(error.message || 'OTP验证失败');
      setLoading(false);
    }
  };

  // 重新发送OTP
  const handleResendOTP = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await safeFetch('/api/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: customerData.identityInfo.phoneNumber,
          userId: customerData.userId,
          scenario: 'customerTransfer',
          scenarioData: {
            amount: parseFloat(amount),
            recipientName: recipientData.identityInfo.displayName,
            recipientPhone: maskPhoneNumber(recipientData.identityInfo.phoneNumber)
          }
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || '重新发送失败');
      }

      setOtpSessionId(result.sessionId);
      setOtpExpiresIn(result.expiresIn || 300);

      console.log('[CustomerTransfer] OTP重新发送成功');

    } catch (error) {
      console.error('[CustomerTransfer] 重新发送OTP失败:', error);
      setError(error.message || '重新发送失败');
    } finally {
      setLoading(false);
    }
  };

  // 执行转让
  const executeTransfer = async (otpSessionId) => {
    setStep('processing');
    setLoading(true);

    try {
      const transferPoints = httpsCallable(functions, 'transferPoints');
      
      const result = await transferPoints({
        toPhoneNumber: recipientData.identityInfo.phoneNumber,
        amount: parseFloat(amount),
        otpSessionId: otpSessionId || null
      });

      console.log('[CustomerTransfer] 转让成功:', result.data);

      setStep('success');

      // 3秒后返回主页
      setTimeout(() => {
        navigate('/customer/dashboard');
      }, 3000);

    } catch (error) {
      console.error('[CustomerTransfer] 转让失败:', error);
      setError(error.message || '转让失败');
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  // 返回上一步
  const handleBack = () => {
    if (step === 'confirm') {
      setStep('input');
      setRecipientData(null);
      setAmount('');
      setAmountError('');
    } else if (step === 'otp') {
      setStep('confirm');
    }
  };

  // 取消转让
  const handleCancel = () => {
    navigate('/customer/dashboard');
  };

  if (!customerData) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 顶部导航 */}
      <div style={styles.header}>
        <button onClick={handleCancel} style={styles.backButton}>
          ← 取消
        </button>
        <h1 style={styles.title}>点数转让</h1>
        <div style={{ width: '60px' }}></div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={styles.errorBanner}>
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={styles.closeButton}>✕</button>
        </div>
      )}

      {/* 步骤1：输入接收方手机号 */}
      {step === 'input' && (
        <div style={styles.content}>
          {/* 余额显示 */}
          <div style={styles.balanceCard}>
            <p style={styles.balanceLabel}>可用余额</p>
            <p style={styles.balanceAmount}>
              {customerData.customer?.pointsAccount?.availablePoints || 0} 点
            </p>
          </div>

          {/* 输入手机号 */}
          <div style={styles.inputCard}>
            <label style={styles.inputLabel}>接收方手机号</label>
            <input
              type="tel"
              value={recipientPhone}
              onChange={(e) => {
                setRecipientPhone(e.target.value);
                setPhoneError('');
              }}
              placeholder="例：0123456789 或 +60123456789"
              style={{
                ...styles.input,
                ...(phoneError ? styles.inputError : {})
              }}
              disabled={loading}
              autoFocus
            />
            {phoneError && <p style={styles.errorText}>{phoneError}</p>}
          </div>

          {/* 查询按钮 */}
          <button
            onClick={handleSearchRecipient}
            disabled={loading || !recipientPhone}
            style={{
              ...styles.button,
              ...styles.primaryButton,
              ...(loading || !recipientPhone ? styles.buttonDisabled : {})
            }}
          >
            {loading ? '查询中...' : '查询接收方'}
          </button>

          {/* 提示 */}
          <div style={styles.tips}>
            <p style={styles.tipTitle}>💡 转让提示：</p>
            <ul style={styles.tipList}>
              <li>确保输入正确的接收方手机号</li>
              <li>接收方必须已注册Customer账户</li>
              <li>转让后无法撤销</li>
              <li>最小转让金额：1点</li>
            </ul>
          </div>
        </div>
      )}

      {/* 步骤2：确认转让 */}
      {step === 'confirm' && recipientData && (
        <div style={styles.content}>
          {/* 接收方信息 */}
          <div style={styles.recipientCard}>
            <div style={styles.recipientHeader}>
              <div style={styles.recipientIcon}>👤</div>
              <div>
                <h2 style={styles.recipientName}>
                  {recipientData.identityInfo.displayName}
                </h2>
                <p style={styles.recipientPhone}>
                  {maskPhoneNumber(recipientData.identityInfo.phoneNumber)}
                </p>
              </div>
            </div>
            <div style={styles.recipientBadge}>✅ 已验证</div>
          </div>

          {/* 余额显示 */}
          <div style={styles.balanceCard}>
            <p style={styles.balanceLabel}>可用余额</p>
            <p style={styles.balanceAmount}>
              {customerData.customer?.pointsAccount?.availablePoints || 0} 点
            </p>
          </div>

          {/* 金额输入 */}
          <div style={styles.inputCard}>
            <label style={styles.inputLabel}>转让金额</label>
            <div style={styles.amountInputContainer}>
              <input
                type="number"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError('');
                }}
                placeholder="0"
                style={{
                  ...styles.amountInput,
                  ...(amountError ? styles.inputError : {})
                }}
                disabled={loading}
                autoFocus
              />
              <span style={styles.amountUnit}>点</span>
            </div>
            {amountError && <p style={styles.errorText}>{amountError}</p>}
          </div>

          {/* 操作按钮 */}
          <div style={styles.actions}>
            <button
              onClick={handleBack}
              disabled={loading}
              style={{
                ...styles.button,
                ...styles.secondaryButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              返回修改
            </button>
            <button
              onClick={handleConfirmTransfer}
              disabled={loading}
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              {loading ? '处理中...' : '确认转让'}
            </button>
          </div>
        </div>
      )}

      {/* 步骤3：OTP验证 */}
      {step === 'otp' && (
        <div style={styles.content}>
          <OTPInput
            onComplete={handleOTPComplete}
            onResend={handleResendOTP}
            expiresIn={otpExpiresIn}
            loading={loading}
          />
          
          <div style={styles.otpInfo}>
            <p style={styles.otpInfoText}>
              转让金额：<strong>{amount} 点</strong>
            </p>
            <p style={styles.otpInfoText}>
              接收方：<strong>{recipientData.identityInfo.displayName}</strong>
            </p>
          </div>

          <button
            onClick={handleBack}
            disabled={loading}
            style={styles.cancelOtpButton}
          >
            取消转让
          </button>
        </div>
      )}

      {/* 步骤4：处理中 */}
      {step === 'processing' && (
        <div style={styles.processingContainer}>
          <div style={styles.spinner}></div>
          <p style={styles.processingText}>转让处理中...</p>
          <p style={styles.processingSubtext}>请稍候</p>
        </div>
      )}

      {/* 步骤5：成功 */}
      {step === 'success' && (
        <div style={styles.successContainer}>
          <div style={styles.successIcon}>✅</div>
          <h2 style={styles.successTitle}>转让成功！</h2>
          <div style={styles.successDetails}>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>接收方：</span>
              <span style={styles.detailValue}>{recipientData.identityInfo.displayName}</span>
            </p>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>金额：</span>
              <span style={styles.detailValue}>{amount} 点</span>
            </p>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>剩余余额：</span>
              <span style={styles.detailValue}>
                {(customerData.customer?.pointsAccount?.availablePoints || 0) - parseFloat(amount)} 点
              </span>
            </p>
          </div>
          <p style={styles.successSubtext}>3秒后自动返回...</p>
          <button
            onClick={() => navigate('/customer/dashboard')}
            style={styles.returnButton}
          >
            立即返回
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  loadingCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#fff',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  backButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    backgroundColor: 'transparent',
    color: '#2196F3',
    border: 'none',
    cursor: 'pointer'
  },
  title: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#333',
    margin: 0
  },
  errorBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    margin: '1rem',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '8px',
    color: '#856404'
  },
  closeButton: {
    padding: '0.25rem 0.5rem',
    fontSize: '1rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#856404'
  },
  content: {
    padding: '1rem'
  },
  balanceCard: {
    marginBottom: '1rem',
    padding: '1rem 1.5rem',
    backgroundColor: '#f0f7ff',
    borderRadius: '8px',
    border: '1px solid #2196F3'
  },
  balanceLabel: {
    fontSize: '0.9rem',
    color: '#666',
    margin: '0 0 0.25rem 0'
  },
  balanceAmount: {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: '#2196F3',
    margin: 0
  },
  inputCard: {
    marginBottom: '1.5rem',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  inputLabel: {
    display: 'block',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '0.75rem'
  },
  input: {
    width: '100%',
    padding: '0.75rem 1rem',
    fontSize: '1rem',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  inputError: {
    borderColor: '#f44336'
  },
  errorText: {
    margin: '0.5rem 0 0 0',
    fontSize: '0.85rem',
    color: '#f44336'
  },
  button: {
    flex: 1,
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '600',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#2196F3',
    color: '#fff'
  },
  secondaryButton: {
    backgroundColor: '#fff',
    color: '#2196F3',
    border: '1px solid #2196F3'
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  tips: {
    marginTop: '1.5rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  tipTitle: {
    margin: '0 0 0.5rem 0',
    fontWeight: '600',
    color: '#666',
    fontSize: '0.9rem'
  },
  tipList: {
    margin: 0,
    paddingLeft: '1.5rem',
    color: '#666',
    fontSize: '0.85rem'
  },
  recipientCard: {
    marginBottom: '1rem',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    position: 'relative'
  },
  recipientHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  recipientIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#4CAF50',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '2rem'
  },
  recipientName: {
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 0.25rem 0'
  },
  recipientPhone: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  recipientBadge: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    padding: '0.25rem 0.75rem',
    fontSize: '0.8rem',
    backgroundColor: '#4CAF50',
    color: '#fff',
    borderRadius: '12px',
    fontWeight: '600'
  },
  amountInputContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  amountInput: {
    flex: 1,
    padding: '1rem',
    fontSize: '2rem',
    fontWeight: '600',
    textAlign: 'center',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none'
  },
  amountUnit: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#666'
  },
  actions: {
    display: 'flex',
    gap: '1rem'
  },
  otpInfo: {
    marginTop: '1.5rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  otpInfoText: {
    margin: '0.5rem 0',
    fontSize: '0.9rem',
    color: '#666'
  },
  cancelOtpButton: {
    width: '100%',
    marginTop: '1rem',
    padding: '0.75rem',
    fontSize: '0.9rem',
    backgroundColor: '#fff',
    color: '#f44336',
    border: '1px solid #f44336',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  processingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    gap: '1rem'
  },
  processingText: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#333',
    margin: 0
  },
  processingSubtext: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  successContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: '2rem'
  },
  successIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  successTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: '1.5rem'
  },
  successDetails: {
    width: '100%',
    maxWidth: '400px',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    marginBottom: '1rem'
  },
  successDetail: {
    display: 'flex',
    justifyContent: 'space-between',
    margin: '0.75rem 0',
    fontSize: '1rem'
  },
  detailLabel: {
    color: '#666'
  },
  detailValue: {
    fontWeight: '600',
    color: '#333'
  },
  successSubtext: {
    fontSize: '0.9rem',
    color: '#999',
    marginBottom: '1rem'
  },
  returnButton: {
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

export default CustomerTransfer;
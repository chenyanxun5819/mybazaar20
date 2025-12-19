import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import QRScanner from '../../components/QRScanner';
import { parseQRData } from '../../utils/qrCodeGenerator';
import OTPInput from '../../components/OTPInput';

/**
 * Customer付款页面
 * 
 * 流程：
 * 1. 扫描Merchant QR Code
 * 2. 显示商家信息，输入金额
 * 3. 确认付款（如需OTP，发送验证码）
 * 4. 输入OTP（如果需要）
 * 5. 执行付款
 */
const CustomerPayment = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  
  // 页面状态
  const [step, setStep] = useState('scan'); // scan | confirm | otp | processing | success
  
  // 用户数据
  const [customerData, setCustomerData] = useState(null);
  
  // 商家数据
  const [merchantData, setMerchantData] = useState(null);
  
  // 付款数据
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
    // 验证 orgEventCode 格式
    if (!orgEventCode || !orgEventCode.includes('-')) {
      setError(`❌ URL 格式错误: 链接应为 /customer/orgCode-eventCode/payment，当前为 /customer/${orgEventCode}/payment\n\n正确示例：/customer/chhsban-2025/payment`);
      return;
    }
    loadCustomerData();
  }, [orgEventCode]);

  // 加载Customer数据
  const loadCustomerData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        console.error('[CustomerPayment] 用户未登录');
        setError('❌ 用户未登录，请返回登录页面');
        navigate('/universal-login');
        return;
      }

      const tokenResult = await user.getIdTokenResult();
      const { organizationId, eventId } = tokenResult.claims;

      console.log('[CustomerPayment] Custom Claims:', { organizationId, eventId });

      if (!organizationId || !eventId) {
        console.error('[CustomerPayment] 缺少 Custom Claims 中的组织或活动 ID');
        setError(`❌ 账户信息不完整。\n\n可能原因：\n• 用户 Custom Claims 未正确设置\n• 需要重新登录\n• 请检查 Firebase 控制台中用户的 Custom Claims 配置`);
        return;
      }

      const customerRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', user.uid
      );

      const customerSnap = await getDoc(customerRef);
      if (customerSnap.exists()) {
        console.log('[CustomerPayment] 用户数据加载成功');
        setCustomerData({
          ...customerSnap.data(),
          organizationId,
          eventId,
          userId: user.uid
        });
      } else {
        console.error('[CustomerPayment] 找不到用户数据');
        setError('❌ 找不到用户数据。请确保已完成用户注册。');
      }
    } catch (error) {
      console.error('[CustomerPayment] 加载失败:', error);
      console.error('[CustomerPayment] 错误详情:', error.message);
      setError(`❌ 加载失败：${error.message}\n\n可能原因：\n• Firestore 权限不足\n• 网络连接问题\n• 用户数据结构异常`);
    }
  };

  // 扫描成功
  const handleScanSuccess = async (qrData) => {
    console.log('[CustomerPayment] 扫描成功:', qrData);

    // 兼容兩種 QR 類型：MERCHANT_PAYMENT 與 MERCHANT
    let normalized = null;
    try {
      if (qrData?.type === 'MERCHANT_PAYMENT') {
        // 使用工具方法解析並標準化欄位
        const parsed = parseQRData(JSON.stringify(qrData));
        normalized = {
          organizationId: parsed.organizationId,
          eventId: parsed.eventId,
          merchantId: parsed.merchantId
        };
      } else if (qrData?.type === 'MERCHANT') {
        normalized = {
          organizationId: qrData.organizationId || qrData.orgId,
          eventId: qrData.eventId,
          merchantId: qrData.merchantId
        };
      } else {
        throw new Error(`QR Code类型不支持：${qrData?.type || '未知'}`);
      }
    } catch (e) {
      setError(e.message || 'QR Code解析失败');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 读取Merchant数据
      const merchantRef = doc(
        db,
        'organizations', normalized.organizationId,
        'events', normalized.eventId,
        'merchants', normalized.merchantId
      );

      const merchantSnap = await getDoc(merchantRef);
      
      if (!merchantSnap.exists()) {
        throw new Error('商家不存在');
      }

      const merchant = merchantSnap.data();

      // 检查商家是否营业
      if (!merchant.operationStatus?.isActive) {
        throw new Error('商家暂停营业');
      }

      setMerchantData({
        ...merchant,
        merchantId: normalized.merchantId
      });
      
      setStep('confirm');

    } catch (error) {
      console.error('[CustomerPayment] 读取商家失败:', error);
      setError(error.message || '读取商家信息失败');
    } finally {
      setLoading(false);
    }
  };

  // 扫描错误
  const handleScanError = (error) => {
    setError(error);
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

    return true;
  };

  // 确认付款（检查是否需要OTP）
  const handleConfirmPayment = async () => {
    if (!validateAmount()) return;

    setLoading(true);
    setError(null);

    try {
      // 调用sendOtpHttp检查是否需要OTP
      const sendOtpHttp = httpsCallable(functions, 'sendOtpHttp');
      
      const result = await sendOtpHttp({
        phoneNumber: customerData.identityInfo.phoneNumber,
        userId: customerData.userId,
        scenario: 'customerPayment',
        scenarioData: {
          amount: parseFloat(amount),
          merchantName: merchantData.stallName || '商家'
        }
      });

      console.log('[CustomerPayment] sendOTP结果:', result.data);

      if (result.data.otpRequired) {
        // 需要OTP验证
        setOtpRequired(true);
        setOtpSessionId(result.data.sessionId);
        setOtpExpiresIn(result.data.expiresIn || 300);
        setStep('otp');
      } else {
        // 不需要OTP，直接付款
        setOtpRequired(false);
        await executePayment(null);
      }

    } catch (error) {
      console.error('[CustomerPayment] 确认付款失败:', error);
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
      // 验证OTP
      const verifyOtpHttp = httpsCallable(functions, 'verifyOtpHttp');
      
      const result = await verifyOtpHttp({
        sessionId: otpSessionId,
        otp: otp
      });

      console.log('[CustomerPayment] OTP验证成功:', result.data);

      if (result.data.success) {
        // OTP验证成功，执行付款
        await executePayment(otpSessionId);
      } else {
        throw new Error('OTP验证失败');
      }

    } catch (error) {
      console.error('[CustomerPayment] OTP验证失败:', error);
      setError(error.message || 'OTP验证失败');
      setLoading(false);
    }
  };

  // 重新发送OTP
  const handleResendOTP = async () => {
    setLoading(true);
    setError(null);

    try {
      const sendOtpHttp = httpsCallable(functions, 'sendOtpHttp');
      
      const result = await sendOtpHttp({
        phoneNumber: customerData.identityInfo.phoneNumber,
        userId: customerData.userId,
        scenario: 'customerPayment',
        scenarioData: {
          amount: parseFloat(amount),
          merchantName: merchantData.stallName || '商家'
        }
      });

      setOtpSessionId(result.data.sessionId);
      setOtpExpiresIn(result.data.expiresIn || 300);

      console.log('[CustomerPayment] OTP重新发送成功');

    } catch (error) {
      console.error('[CustomerPayment] 重新发送OTP失败:', error);
      setError(error.message || '重新发送失败');
    } finally {
      setLoading(false);
    }
  };

  // 执行付款
  const executePayment = async (otpSessionId) => {
    setStep('processing');
    setLoading(true);

    try {
      const processCustomerPayment = httpsCallable(functions, 'processCustomerPayment');
      
      const result = await processCustomerPayment({
        merchantId: merchantData.merchantId,
        amount: parseFloat(amount),
        otpSessionId: otpSessionId || null
      });

      console.log('[CustomerPayment] 付款成功:', result.data);

      setStep('success');

      // 3秒后返回主页
      setTimeout(() => {
        navigate('/customer/dashboard');
      }, 3000);

    } catch (error) {
      console.error('[CustomerPayment] 付款失败:', error);
      setError(error.message || '付款失败');
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  // 返回上一步
  const handleBack = () => {
    if (step === 'confirm') {
      setStep('scan');
      setMerchantData(null);
      setAmount('');
      setAmountError('');
    } else if (step === 'otp') {
      setStep('confirm');
    }
  };

  // 取消付款
  const handleCancel = () => {
    navigate('/customer/dashboard');
  };

  return (
    <div style={styles.container}>
      {/* 顶部导航 */}
      <div style={styles.header}>
        <button onClick={handleCancel} style={styles.backButton}>
          ← 取消
        </button>
        <h1 style={styles.title}>扫码付款</h1>
        <div style={{ width: '60px' }}></div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={styles.errorBanner}>
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={styles.closeButton}>✕</button>
        </div>
      )}

      {/* 步骤1：扫描QR Code */}
      {step === 'scan' && (
        <div style={styles.content}>
          <QRScanner
            onScan={handleScanSuccess}
            onError={handleScanError}
            expectedType={null} // 接受多種型別，於回調內判斷
            autoStart={true}    // 進頁後自動開啟相機
          />
        </div>
      )}

      {/* 步骤2：确认付款 */}
      {step === 'confirm' && merchantData && (
        <div style={styles.content}>
          {/* 商家信息 */}
          <div style={styles.merchantCard}>
            <div style={styles.merchantHeader}>
              <div style={styles.merchantIcon}>🏪</div>
              <div>
                <h2 style={styles.merchantName}>{merchantData.stallName}</h2>
                <p style={styles.merchantInfo}>
                  摊位号：{merchantData.stallNumber || '未设置'}
                </p>
              </div>
            </div>
          </div>

          {/* 余额显示 */}
          <div style={styles.balanceCard}>
            <p style={styles.balanceLabel}>可用余额</p>
            <p style={styles.balanceAmount}>
              {customerData?.customer?.pointsAccount?.availablePoints || 0} 点
            </p>
          </div>

          {/* 金额输入 */}
          <div style={styles.inputCard}>
            <label style={styles.inputLabel}>付款金额</label>
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
              返回重扫
            </button>
            <button
              onClick={handleConfirmPayment}
              disabled={loading}
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              {loading ? '处理中...' : '确认付款'}
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
              付款金额：<strong>{amount} 点</strong>
            </p>
            <p style={styles.otpInfoText}>
              收款商家：<strong>{merchantData.stallName}</strong>
            </p>
          </div>

          <button
            onClick={handleBack}
            disabled={loading}
            style={styles.cancelOtpButton}
          >
            取消付款
          </button>
        </div>
      )}

      {/* 步骤4：处理中 */}
      {step === 'processing' && (
        <div style={styles.processingContainer}>
          <div style={styles.spinner}></div>
          <p style={styles.processingText}>付款处理中...</p>
          <p style={styles.processingSubtext}>请稍候</p>
        </div>
      )}

      {/* 步骤5：成功 */}
      {step === 'success' && (
        <div style={styles.successContainer}>
          <div style={styles.successIcon}>✅</div>
          <h2 style={styles.successTitle}>付款成功！</h2>
          <div style={styles.successDetails}>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>商家：</span>
              <span style={styles.detailValue}>{merchantData.stallName}</span>
            </p>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>金额：</span>
              <span style={styles.detailValue}>{amount} 点</span>
            </p>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>剩余余额：</span>
              <span style={styles.detailValue}>
                {(customerData?.customer?.pointsAccount?.availablePoints || 0) - parseFloat(amount)} 点
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
  merchantCard: {
    marginBottom: '1rem',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  merchantHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  merchantIcon: {
    fontSize: '2.5rem'
  },
  merchantName: {
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 0.25rem 0'
  },
  merchantInfo: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
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
  inputError: {
    borderColor: '#f44336'
  },
  errorText: {
    margin: '0.5rem 0 0 0',
    fontSize: '0.85rem',
    color: '#f44336'
  },
  actions: {
    display: 'flex',
    gap: '1rem'
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
  spinner: {
    width: '60px',
    height: '60px',
    border: '6px solid #f3f3f3',
    borderTop: '6px solid #2196F3',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
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

export default CustomerPayment;
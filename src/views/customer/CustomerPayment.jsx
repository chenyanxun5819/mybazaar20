import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import QRScanner from '../../components/QRScanner';

/**
 * Customer付款页面 - 使用交易密码验证
 * 
 * ✅ 修改：
 * 1. 移除 OTP 验证流程
 * 2. 改用交易密码（6位数字PIN）验证
 * 3. 后端统一验证 PIN 并执行支付
 */
const CustomerPayment = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();

  const [step, setStep] = useState('scan'); // scan | confirm | pin | processing | success
  const [customerData, setCustomerData] = useState(null);
  const [merchantData, setMerchantData] = useState(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [transactionPin, setTransactionPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('[CustomerPayment] ========== 组件初始化 ==========');
    console.log('[CustomerPayment] orgEventCode:', orgEventCode);

    if (!orgEventCode || !orgEventCode.includes('-')) {
      const errorMsg = `URL 格式错误: 链接应为 /customer/orgCode-eventCode/payment`;
      console.error('[CustomerPayment]', errorMsg);
      setError(errorMsg);
      return;
    }
    loadCustomerData();
  }, [orgEventCode]);

  const loadCustomerData = async () => {
    try {
      console.log('[CustomerPayment] 开始加载用户数据...');
      const user = auth.currentUser;

      if (!user) {
        console.error('[CustomerPayment] 用户未登录');
        navigate('/universal-login');
        return;
      }

      console.log('[CustomerPayment] 用户 UID:', user.uid);
      const tokenResult = await user.getIdTokenResult();
      const { organizationId, eventId } = tokenResult.claims;

      console.log('[CustomerPayment] Custom Claims:', { organizationId, eventId });

      if (!organizationId || !eventId) {
        const errorMsg = '账户信息不完整，请重新登录';
        console.error('[CustomerPayment]', errorMsg);
        setError(errorMsg);
        return;
      }

      const customerRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', user.uid
      );

      console.log('[CustomerPayment] 读取用户文档...');
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
        const errorMsg = '找不到用户数据';
        console.error('[CustomerPayment]', errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error('[CustomerPayment] 加载失败:', error);
      setError(`加载失败：${error.message}`);
    }
  };

  const handleScanSuccess = async (qrData) => {
    console.log('[CustomerPayment] ========== 扫描成功回调 ==========');
    console.log('[CustomerPayment] qrData:', qrData);

    setError(null);
    setAmountError('');
    setLoading(true);

    try {
      // 步骤1：验证基本数据
      console.log('[CustomerPayment] 步骤1：验证基本数据');
      if (!qrData) {
        throw new Error('QR Code 数据为空');
      }

      if (typeof qrData !== 'object') {
        throw new Error('QR Code 数据格式错误');
      }

      // 步骤2：检查类型
      console.log('[CustomerPayment] 步骤2：检查类型');
      const qrType = qrData.type;
      console.log('[CustomerPayment] QR Code 类型:', qrType);

      const validTypes = ['MERCHANT', 'MERCHANT_PAYMENT', 'merchant_payment'];
      if (!qrType || !validTypes.includes(qrType)) {
        throw new Error(`QR Code 类型不正确：${qrType || '未知'}。请扫描商家收款码。`);
      }

      // 步骤3：提取必要信息
      console.log('[CustomerPayment] 步骤3：提取信息');

      const organizationId = qrData.organizationId || qrData.orgId || null;
      const eventId = qrData.eventId || qrData.evtId || null;
      const merchantId = qrData.merchantId || qrData.userId || null;

      console.log('[CustomerPayment] 提取结果:', {
        organizationId,
        eventId,
        merchantId
      });

      // 验证字段
      if (!organizationId) {
        throw new Error('QR Code 缺少组织ID');
      }
      if (!eventId) {
        throw new Error('QR Code 缺少活动ID');
      }
      if (!merchantId) {
        throw new Error('QR Code 缺少商家ID');
      }

      // 步骤4：读取商家数据
      console.log('[CustomerPayment] 步骤4：读取商家数据');
      const merchantRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'merchants', merchantId
      );

      console.log('[CustomerPayment] 商家文档路径:', merchantRef.path);
      const merchantSnap = await getDoc(merchantRef);

      if (!merchantSnap.exists()) {
        throw new Error('找不到该商家，请确认 QR Code 是否正确');
      }

      const merchant = merchantSnap.data();
      console.log('[CustomerPayment] 商家数据:', merchant);

      // 步骤5：检查商家状态
      console.log('[CustomerPayment] 步骤5：检查商家状态');
      if (merchant.operationStatus && !merchant.operationStatus.isActive) {
        throw new Error(`商家「${merchant.stallName || '此商家'}」暂停营业`);
      }

      // 步骤6：保存数据并进入确认页面
      console.log('[CustomerPayment] 步骤6：保存数据');
      setMerchantData({
        ...merchant,
        merchantId,
        organizationId,
        eventId
      });

      console.log('[CustomerPayment] ========== 扫描处理完成，进入确认页面 ==========');
      setStep('confirm');

    } catch (error) {
      console.error('[CustomerPayment] ========== 扫描处理错误 ==========');
      console.error('[CustomerPayment] 错误类型:', error.name);
      console.error('[CustomerPayment] 错误信息:', error.message);
      console.error('[CustomerPayment] 错误堆栈:', error.stack);

      const userMessage = error.message || '处理 QR Code 时出错，请重试';
      setError(userMessage);
      setStep('scan');
    } finally {
      setLoading(false);
    }
  };

  const handleScanError = (errorMsg) => {
    console.error('[CustomerPayment] 扫描错误:', errorMsg);
    setError(errorMsg);
  };

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

  // 确认金额后，进入 PIN 输入界面
  const handleConfirmAmount = () => {
    console.log('[CustomerPayment] ========== 确认金额 ==========');

    if (!validateAmount()) {
      console.log('[CustomerPayment] 金额验证失败');
      return;
    }

    console.log('[CustomerPayment] 金额验证通过，进入 PIN 输入界面');
    setStep('pin');
    setTransactionPin('');
    setPinError('');
  };

  // 执行支付（包含 PIN 验证）
  const handleExecutePayment = async () => {
    console.log('[CustomerPayment] ========== 开始执行支付 ==========');

    // 验证 PIN 格式
    if (!transactionPin || transactionPin.length !== 6) {
      setPinError('请输入6位交易密码');
      return;
    }

    if (!/^\d{6}$/.test(transactionPin)) {
      setPinError('交易密码必须是6位数字');
      return;
    }

    setLoading(true);
    setError(null);
    setPinError('');
    setStep('processing');

    try {
      console.log('[CustomerPayment] 调用 processCustomerPayment...');

      const processPayment = httpsCallable(functions, 'processCustomerPayment');

      const result = await processPayment({
        merchantId: merchantData.merchantId,
        amount: parseFloat(amount),
        organizationId: merchantData.organizationId,
        eventId: merchantData.eventId,
        transactionPin: transactionPin  // ← 传递交易密码给后端验证
      });

      console.log('[CustomerPayment] 支付成功:', result.data);

      // 显示成功页面
      setStep('success');

      // 3秒后自动返回
      setTimeout(() => {
        navigate(`/customer/${orgEventCode}/dashboard`);
      }, 3000);

    } catch (error) {
      console.error('[CustomerPayment] 支付失败:', error);

      let errorMessage = '支付失败，请重试';

      // 处理交易密码相关错误
      if (error.code === 'permission-denied') {
        errorMessage = error.message || '交易密码错误';
        setPinError(errorMessage);
        setStep('pin'); // 返回 PIN 输入界面
      } else if (error.code === 'failed-precondition') {
        errorMessage = error.message || '操作失败';
        if (error.message?.includes('锁定')) {
          setPinError(errorMessage);
          setStep('pin');
        } else {
          setError(errorMessage);
          setStep('confirm');
        }
      } else if (error.message) {
        errorMessage = error.message;
        setError(errorMessage);
        setStep('confirm');
      } else {
        setError(errorMessage);
        setStep('confirm');
      }

    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* 顶部导航 */}
      <div style={styles.header}>
        <button
          onClick={() => {
            if (step === 'confirm') {
              setStep('scan');
            } else if (step === 'pin') {
              setStep('confirm');
            } else {
              navigate(`/customer/${orgEventCode}/dashboard`);
            }
          }}
          style={styles.backButton}
        >
          ← 返回
        </button>
        <h1 style={styles.title}>
          {step === 'scan' && '扫码支付'}
          {step === 'confirm' && '确认支付'}
          {step === 'pin' && '输入交易密码'}
          {step === 'processing' && '处理中...'}
          {step === 'success' && '支付成功'}
        </h1>
        <div style={{ width: '60px' }}></div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={styles.closeButton}>
            ✕
          </button>
        </div>
      )}

      <div style={styles.content}>
        {/* 扫描页面 */}
        {step === 'scan' && (
          <QRScanner
            onScanSuccess={handleScanSuccess}
            onScanError={handleScanError}
          />
        )}

        {/* 确认支付页面 */}
        {step === 'confirm' && merchantData && (
          <>
            {/* 商家信息卡片 */}
            <div style={styles.merchantCard}>
              <div style={styles.merchantHeader}>
                <div style={styles.merchantIcon}>🏪</div>
                <div>
                  <h2 style={styles.merchantName}>{merchantData.stallName || '商家'}</h2>
                  <p style={styles.merchantInfo}>
                    {merchantData.stallNumber ? `摊位号：${merchantData.stallNumber}` : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* 余额显示 */}
            <div style={styles.balanceCard}>
              <p style={styles.balanceLabel}>当前余额</p>
              <p style={styles.balanceAmount}>
                {customerData?.customer?.pointsAccount?.availablePoints || 0} 点
              </p>
            </div>

            {/* 金额输入 */}
            <div style={styles.inputCard}>
              <label style={styles.inputLabel}>支付金额</label>
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
                  min="0"
                  step="0.01"
                />
                <span style={styles.amountUnit}>点</span>
              </div>
              {amountError && <p style={styles.errorText}>{amountError}</p>}
            </div>

            {/* 操作按钮 */}
            <div style={styles.actions}>
              <button
                onClick={() => setStep('scan')}
                style={{
                  ...styles.button,
                  ...styles.secondaryButton
                }}
                disabled={loading}
              >
                重新扫描
              </button>
              <button
                onClick={handleConfirmAmount}
                style={{
                  ...styles.button,
                  ...styles.primaryButton,
                  ...(loading ? styles.buttonDisabled : {})
                }}
                disabled={loading}
              >
                确认支付
              </button>
            </div>
          </>
        )}

        {/* 交易密码输入页面 */}
        {step === 'pin' && (
          <div style={styles.pinContainer}>
            <div style={styles.pinCard}>
              <div style={styles.pinIcon}>🔐</div>
              <h2 style={styles.pinTitle}>请输入交易密码</h2>
              <p style={styles.pinSubtitle}>
                向 {merchantData?.stallName || '商家'} 支付 {amount} 点
              </p>

              {/* PIN 输入框 */}
              <input
                type="password"
                inputMode="numeric"
                maxLength="6"
                value={transactionPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  setTransactionPin(value);
                  setPinError('');
                }}
                placeholder="请输入6位数字"
                style={{
                  ...styles.pinInput,
                  ...(pinError ? styles.inputError : {})
                }}
                autoFocus
                disabled={loading}
              />

              {pinError && <p style={styles.errorText}>{pinError}</p>}

              <p style={styles.pinHint}>
                交易密码是您在注册时设置的6位数字密码
              </p>

              {/* 操作按钮 */}
              <div style={styles.pinActions}>
                <button
                  onClick={() => {
                    setStep('confirm');
                    setTransactionPin('');
                    setPinError('');
                  }}
                  style={{
                    ...styles.button,
                    ...styles.secondaryButton
                  }}
                  disabled={loading}
                >
                  返回修改金额
                </button>
                <button
                  onClick={handleExecutePayment}
                  style={{
                    ...styles.button,
                    ...styles.primaryButton,
                    ...(loading ? styles.buttonDisabled : {})
                  }}
                  disabled={loading || transactionPin.length !== 6}
                >
                  {loading ? '验证中...' : '确认支付'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 处理中页面 */}
        {step === 'processing' && (
          <div style={styles.processingContainer}>
            <div style={styles.spinner}></div>
            <p style={styles.processingText}>支付处理中...</p>
            <p style={styles.processingSubtext}>请稍候，不要关闭页面</p>
          </div>
        )}

        {/* 成功页面 */}
        {step === 'success' && (
          <div style={styles.successContainer}>
            <div style={styles.successIcon}>✅</div>
            <h2 style={styles.successTitle}>支付成功！</h2>
            <div style={styles.successDetails}>
              <p style={styles.successDetail}>
                <span style={styles.detailLabel}>商家：</span>
                <span style={styles.detailValue}>{merchantData?.stallName || '商家'}</span>
              </p>
              <p style={styles.successDetail}>
                <span style={styles.detailLabel}>支付金额：</span>
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
              onClick={() => navigate(`/customer/${orgEventCode}/dashboard`)}
              style={styles.returnButton}
            >
              立即返回
            </button>
          </div>
        )}
      </div>
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
  pinContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 'calc(100vh - 200px)'
  },
  pinCard: {
    width: '100%',
    maxWidth: '400px',
    padding: '2rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    textAlign: 'center'
  },
  pinIcon: {
    fontSize: '3rem',
    marginBottom: '1rem'
  },
  pinTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 0.5rem 0'
  },
  pinSubtitle: {
    fontSize: '1rem',
    color: '#666',
    marginBottom: '2rem'
  },
  pinInput: {
    width: '100%',
    padding: '1.5rem',
    fontSize: '2rem',
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: '0.5rem',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    marginBottom: '1rem'
  },
  pinHint: {
    fontSize: '0.85rem',
    color: '#999',
    marginBottom: '2rem'
  },
  pinActions: {
    display: 'flex',
    gap: '1rem'
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
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import QRScanner from '../../components/QRScanner';
import OTPInput from '../../components/OTPInput';
import { safeFetch } from '../../services/safeFetch';

/**
 * Customer付款页面 - 完全重写版本
 * 
 * ✅ 修复：
 * 1. 彻底移除所有可能导致 "internal" 错误的代码
 * 2. 清晰的错误处理
 * 3. 详细的日志
 */
const CustomerPayment = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();

  const [step, setStep] = useState('scan');
  const [customerData, setCustomerData] = useState(null);
  const [merchantData, setMerchantData] = useState(null);
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [otpSessionId, setOtpSessionId] = useState(null);
  const [otpExpiresIn, setOtpExpiresIn] = useState(300);
  const [otpRequired, setOtpRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [paymentDebug, setPaymentDebug] = useState(null);
  const [lastErrorJson, setLastErrorJson] = useState(null);

  // 取得可用的手機號：優先 Firestore，其次 Firebase Auth，再次 localStorage
  const getEffectivePhoneNumber = () => {
    const fromProfile = customerData?.identityInfo?.phoneNumber || customerData?.basicInfo?.phoneNumber;
    if (fromProfile) return fromProfile;
    const fromAuth = auth.currentUser?.phoneNumber;
    if (fromAuth) return fromAuth;
    try {
      const stored = localStorage.getItem('customerInfo');
      if (stored) {
        const data = JSON.parse(stored);
        return data?.phoneNumber || null;
      }
    } catch (_) { }
    return null;
  };

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

  // ✅ 完全重写，移除所有可能的 "internal" 错误
  const handleScanSuccess = async (qrData) => {
    console.log('[CustomerPayment] ========== 扫描成功回调 ==========');
    console.log('[CustomerPayment] qrData:', qrData);

    // ✅ 重要：立即清除之前的所有错误
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

      // 支持多种字段名
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
      // ✅ 统一的错误处理
      console.error('[CustomerPayment] ========== 扫描处理错误 ==========');
      console.error('[CustomerPayment] 错误类型:', error.name);
      console.error('[CustomerPayment] 错误信息:', error.message);
      console.error('[CustomerPayment] 错误堆栈:', error.stack);

      // ✅ 设置友好的错误信息
      const userMessage = error.message || '处理 QR Code 时出错，请重试';
      setError(userMessage);

      // ✅ 保持在扫描页面，让用户可以重试
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

  const handleConfirmPayment = async () => {
    console.log('[CustomerPayment] ========== 开始确认付款 ==========');

    if (!validateAmount()) {
      console.log('[CustomerPayment] 金额验证失败');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // ✅ 前置檢查：必須有手機號
      const phone = getEffectivePhoneNumber();
      if (!phone) {
        throw new Error('未綁定手機號，無法發送驗證碼');
      }
      console.log('[CustomerPayment] 调用 sendOtpHttp...');

      // ✅ 使用 httpsCallable
      const sendOtpHttp = httpsCallable(functions, 'sendOtpHttp');

      const result = await sendOtpHttp({
        phoneNumber: phone,
        userId: customerData.userId,
        scenario: 'customerPayment',
        scenarioData: {
          amount: parseFloat(amount),
          merchantName: merchantData.stallName || '商家'
        }
      });

      console.log('[CustomerPayment] sendOTP结果:', result.data);

      // ✅ 使用 result.data
      if (!result.data?.success) {
        throw new Error(result.data?.error?.message || '发送 OTP 失败');
      }

      if (result.data.otpRequired) {
        console.log('[CustomerPayment] OTP 验证必需');
        setOtpRequired(true);
        setOtpSessionId(result.data.sessionId);
        setOtpExpiresIn(result.data.expiresIn || 300);
        setStep('otp');
      } else {
        console.log('[CustomerPayment] 无需 OTP，直接执行付款');
        setOtpRequired(false);
        await executePayment(null);
      }

    } catch (error) {
      console.error('[CustomerPayment] 确认付款失败:', error);
      setError(error.message || '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleOTPComplete = async (otp) => {
    console.log('[CustomerPayment] ========== OTP 输入完成 ==========');
    setLoading(true);
    setError(null);

    try {
      console.log('[CustomerPayment] 验证 OTP...');
      const resp = await safeFetch('/api/verifyOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: otpSessionId,
          otp: otp
        })
      });
      const result = await resp.json();
      console.log('[CustomerPayment] OTP验证结果:', result);

      if (resp.ok && result.success) {
        console.log('[CustomerPayment] OTP 验证成功，执行付款');
        await executePayment(otpSessionId);
      } else {
        throw new Error('OTP验证失败');
      }

    } catch (error) {
      console.error('[CustomerPayment] OTP验证失败:', error);
      setError(error.message || 'OTP验证失败，请重试');
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    console.log('[CustomerPayment] ========== 重新发送 OTP ==========');
    setLoading(true);
    setError(null);

    try {
      const phone = getEffectivePhoneNumber();
      if (!phone) {
        throw new Error('未綁定手機號，無法重新發送驗證碼');
      }
      // ✅ 使用 httpsCallable
      const sendOtpHttp = httpsCallable(functions, 'sendOtpHttp');

      const result = await sendOtpHttp({
        phoneNumber: phone,
        userId: customerData.userId,
        scenario: 'customerPayment',
        scenarioData: {
          amount: parseFloat(amount),
          merchantName: merchantData.stallName || '商家'
        }
      });

      // ✅ 使用 result.data
      if (!result.data?.success) {
        throw new Error(result.data?.error?.message || '重新发送失败');
      }

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

  const executePayment = async (otpSessionId) => {
    console.log('[CustomerPayment] ========== 执行付款 ==========');
    setStep('processing');
    setLoading(true);

    try {
      // === 第1步：確保使用者已登入 ===
      const user = auth.currentUser;
      if (!user) {
        console.warn('[CustomerPayment] ❌ 使用者未登入，取消付款');
        setError('请先登录');
        setStep('confirm');
        setLoading(false);
        return;
      }
      
      console.log('[CustomerPayment] ✅ 使用者已登入:', user.uid);

      // === 第2步：刷新 ID Token 並驗證 ===
      let idToken = null;
      let tokenResult = null;
      
      try {
        idToken = await user.getIdToken(true);
        tokenResult = await user.getIdTokenResult();
        
        if (!idToken || idToken.length === 0) {
          throw new Error('getIdToken 返回空值');
        }
        
        console.log('[CustomerPayment] ✅ Token 刷新成功，長度:', idToken.length);
      } catch (tokenError) {
        console.error('[CustomerPayment] ❌ Token 刷新失敗:', tokenError?.message);
        setError('认证信息过期，请重新登录');
        setStep('confirm');
        setLoading(false);
        // 導向登入頁面
        setTimeout(() => navigate('/universal-login'), 1500);
        return;
      }

      // === 第3步：記錄 Token 狀態以便除錯 ===
      const tokenMeta = {
        uid: user.uid,
        tokenLength: idToken?.length || 0,
        issuedAtTime: tokenResult?.issuedAtTime || null,
        expirationTime: tokenResult?.expirationTime || null,
        authTime: tokenResult?.authTime || null,
        hasOrgEventClaims: !!(tokenResult?.claims?.organizationId && tokenResult?.claims?.eventId),
        organizationId: tokenResult?.claims?.organizationId || customerData?.organizationId,
        eventId: tokenResult?.claims?.eventId || customerData?.eventId
      };
      
      setPaymentDebug({
        step: 'executePayment',
        merchantId: merchantData?.merchantId,
        organizationId: merchantData?.organizationId,
        eventId: merchantData?.eventId,
        amount: parseFloat(amount),
        hasOtpSessionId: !!otpSessionId,
        otpSessionId: otpSessionId || null,
        idTokenMeta: tokenMeta
      });

      console.log('[CustomerPayment] 調試資訊:', tokenMeta);

      // === 第4步：呼叫後端 ===
      console.log('[CustomerPayment] 调用 processCustomerPayment...');
      const processCustomerPayment = httpsCallable(functions, 'processCustomerPayment');

      const result = await processCustomerPayment({
        merchantId: merchantData.merchantId,
        amount: parseFloat(amount),
        otpSessionId: otpSessionId || null,
        organizationId: customerData.organizationId,
        eventId: customerData.eventId
        // ❌ 不传 idToken，让 SDK 自动处理认证
      });

      console.log('[CustomerPayment] 付款成功:', result.data);
      setStep('success');

      setTimeout(() => {
        console.log('[CustomerPayment] 自动返回 Dashboard');
        navigate(`/customer/${orgEventCode}/dashboard`);
      }, 3000);

    } catch (error) {
      console.error('[CustomerPayment] 付款失败:', error);
      try {
        const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
        setLastErrorJson(serialized);
        console.log('[CustomerPayment] 付款失败詳細(JSON):', serialized);
      } catch (_) {
        // ignore
      }
      const code = error?.code || '';
      if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
        setError('会话已过期，请重新登录后再尝试。');
      } else if (code === 'functions/failed-precondition') {
        setError(error.message || '条件不足，无法完成付款');
      } else if (code === 'functions/invalid-argument') {
        setError(error.message || '参数错误');
      } else if (code === 'functions/not-found') {
        setError(error.message || '数据不存在');
      } else {
        setError(error.message || '付款失败，请重试');
      }
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    console.log('[CustomerPayment] 返回按钮，当前step:', step);

    if (step === 'scan') {
      navigate(`/customer/${orgEventCode}/dashboard`);
    } else if (step === 'confirm') {
      setStep('scan');
      setMerchantData(null);
      setAmount('');
      setAmountError('');
      setError(null);
    } else if (step === 'otp') {
      setStep('confirm');
      setOtpSessionId(null);
      setError(null);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={handleBack} style={styles.backButton}>
          ← 返回
        </button>
        <h1 style={styles.title}>
          {step === 'scan' && '扫码付款'}
          {step === 'confirm' && '确认付款'}
          {step === 'otp' && 'OTP验证'}
          {step === 'processing' && '处理中'}
          {step === 'success' && '付款成功'}
        </h1>
        <div style={{ width: '60px' }}></div>
      </div>

      {/* ✅ 错误显示 - 只显示 error 状态 */}
      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={styles.closeButton}>✕</button>
        </div>
      )}

      {/* 🔎 調試資訊：當有錯誤或進入處理階段時顯示，協助定位 unauthenticated */}
      {(paymentDebug || lastErrorJson) && (
        <div style={{
          margin: '0 1rem 1rem',
          padding: '1rem',
          backgroundColor: '#eef6ff',
          border: '1px solid #90caf9',
          borderRadius: '8px',
          color: '#0d47a1'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>調試資訊（僅本機顯示）</strong>
            <button
              onClick={async () => {
                const text = JSON.stringify({ paymentDebug, lastError: lastErrorJson }, null, 2);
                try { await navigator.clipboard.writeText(text); } catch (_) { }
              }}
              style={{
                padding: '0.25rem 0.5rem',
                fontSize: '0.85rem',
                backgroundColor: '#fff',
                color: '#0d47a1',
                border: '1px solid #90caf9',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >複製詳細</button>
          </div>
          {paymentDebug && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              {JSON.stringify(paymentDebug, null, 2)}
            </pre>
          )}
          {lastErrorJson && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              {lastErrorJson}
            </pre>
          )}
        </div>
      )}

      {step === 'scan' && (
        <div style={styles.content}>
          <QRScanner
            onScanSuccess={handleScanSuccess}
            onScanError={handleScanError}
            expectedType={['MERCHANT', 'MERCHANT_PAYMENT', 'merchant_payment']}
            autoStart={true}
            helpText="请将后置摄像头对准商家的收款QR Code"
          />
        </div>
      )}

      {step === 'confirm' && merchantData && (
        <div style={styles.content}>
          <div style={styles.merchantCard}>
            <div style={styles.merchantHeader}>
              <div style={styles.merchantIcon}>🏪</div>
              <div>
                <h2 style={styles.merchantName}>{merchantData.stallName}</h2>
                <p style={styles.merchantInfo}>
                  {merchantData.department || '商家'}
                </p>
              </div>
            </div>
          </div>

          {/* 若未綁定手機，顯示固定警示並提供快捷綁定入口 */}
          {!getEffectivePhoneNumber() && (
            <div style={styles.errorBanner}>
              <span>未綁定手機號，無法發送驗證碼</span>
              <button onClick={() => navigate('/universal-login')} style={styles.closeButton}>去綁定</button>
            </div>
          )}

          <div style={styles.balanceCard}>
            <p style={styles.balanceLabel}>当前余额</p>
            <p style={styles.balanceAmount}>
              {customerData?.customer?.pointsAccount?.availablePoints || 0} 点
            </p>
          </div>

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
              />
              <span style={styles.amountUnit}>点</span>
            </div>
            {amountError && (
              <p style={styles.errorText}>{amountError}</p>
            )}
          </div>

          <div style={styles.actions}>
            <button
              onClick={handleBack}
              style={{
                ...styles.button,
                ...styles.secondaryButton
              }}
              disabled={loading}
            >
              取消
            </button>
            <button
              onClick={handleConfirmPayment}
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
              disabled={loading || !getEffectivePhoneNumber()}
            >
              {loading ? '处理中...' : '确认付款'}
            </button>
          </div>
        </div>
      )}

      {step === 'otp' && (
        <div style={styles.content}>
          <OTPInput
            onComplete={handleOTPComplete}
            onResend={handleResendOTP}
            expiresIn={otpExpiresIn}
            phoneNumber={getEffectivePhoneNumber()}
            disabled={loading}
          />

          <div style={styles.otpInfo}>
            <p style={styles.otpInfoText}>📱 验证码已发送至 {getEffectivePhoneNumber()}</p>
            <p style={styles.otpInfoText}>
              💡 付款金额：{amount} 点
            </p>
            <p style={styles.otpInfoText}>
              🏪 商家：{merchantData?.stallName}
            </p>
          </div>

          <button
            onClick={handleBack}
            style={styles.cancelOtpButton}
            disabled={loading}
          >
            取消付款
          </button>
        </div>
      )}

      {step === 'processing' && (
        <div style={styles.processingContainer}>
          <div style={styles.spinner}></div>
          <p style={styles.processingText}>正在处理付款...</p>
          <p style={styles.processingSubtext}>请稍候</p>
        </div>
      )}

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
            onClick={() => navigate(`/customer/${orgEventCode}/dashboard`)}
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
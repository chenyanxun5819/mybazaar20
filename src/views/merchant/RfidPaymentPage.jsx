import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc,
  writeBatch,
  serverTimestamp 
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { auth, db, functions } from '../../config/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { useMerchantData } from '../../hooks/useMerchantData';
import DashboardHeader from '../../components/common/DashboardHeader';
import DashboardFooter from '../../components/common/DashboardFooter';
import MerchantTransactions from '../../components/merchant/MerchantTransactions';
import PaymentAmountForm from '../../components/merchant/PaymentAmountForm';
import PinInput from '../../components/PinInput/PinInput';
import './RfidPaymentPage.css';

/**
 * RfidPaymentPage - RFID卡支付页面
 * 流程：RFID输入 → 显示客户信息 → 金额输入 → PIN验证 → 支付处理
 */
const RfidPaymentPage = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { event } = useEvent();
  const currentUser = auth.currentUser;
  const currentMerchantRole = userProfile?.roles?.includes('merchantAsist')
    ? 'merchantAsist'
    : 'merchantOwner';

  // 路由参数解析
  const [organizationId, setOrganizationId] = useState(null);
  const [eventId, setEventId] = useState(null);

  // 商家信息
  const {
    merchant,
    loading: merchantLoading,
    error: merchantError,
    refreshStats
  } = useMerchantData(currentUser?.uid, organizationId, eventId);

  // 页面状态
  const [step, setStep] = useState('rfid'); // 'rfid' | 'confirm' | 'pin' | 'processing' | 'success' | 'error'
  const [rfidInput, setRfidInput] = useState('');
  const [amount, setAmount] = useState('');
  const [customerData, setCustomerData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transactionPin, setTransactionPin] = useState('');
  const [pinError, setPinError] = useState('');

  // 交易记录
  const [pendingTransaction, setPendingTransaction] = useState(null);
  const rfidInputRef = useRef(null);

  // 设置组织和活动 ID
  useEffect(() => {
    if (userProfile?.organizationId && userProfile?.eventId) {
      setOrganizationId(userProfile.organizationId);
      setEventId(userProfile.eventId);
      return;
    }

    if (orgEventCode) {
      const [orgCode, eventCode] = orgEventCode.split('-');
      setOrganizationId(orgCode);
      setEventId(eventCode);
    }
  }, [userProfile?.organizationId, userProfile?.eventId, orgEventCode]);

  // 自动聚焦 RFID 输入框
  useEffect(() => {
    if (step === 'rfid' && rfidInputRef.current) {
      rfidInputRef.current.focus();
    }
  }, [step]);

  /**
   * 查询客户信息（通过 RFID）
   */
  const handleRfidSearch = async (rfid) => {
    if (!rfid.trim()) {
      setError('请输入 RFID 卡号');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('[RfidPaymentPage] 查询 RFID:', rfid);

      // 查询用户集合，匹配 basicInfo.rfidCard.rfidId
      const usersRef = collection(db, 'organizations', organizationId, 'users');
      const q = query(
        usersRef,
        where('basicInfo.rfidCard.rfidId', '==', rfid)
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError('❌ 未找到该 RFID 卡，请检查卡号');
        return;
      }

      const userDoc = snapshot.docs[0];
      const userData = userDoc.data();

      // 验证 RFID 卡状态
      if (userData.basicInfo?.rfidCard?.status !== 'active') {
        setError('❌ 该 RFID 卡未激活或已禁用');
        return;
      }

      // 获取客户点数账户信息
      const customerRef = doc(
        db,
        'organizations',
        organizationId,
        'events',
        eventId,
        'customers',
        userDoc.id
      );
      const customerDoc = await getDoc(customerRef);

      if (!customerDoc.exists()) {
        setError('❌ 客户在本活动中未注册');
        return;
      }

      const customer = customerDoc.data();
      setCustomerData({
        userId: userDoc.id,
        basicInfo: userData.basicInfo,
        customer: customer,
        rfidCard: userData.basicInfo.rfidCard
      });

      console.log('[RfidPaymentPage] 找到客户:', customer.basicInfo?.chineseName);
      setStep('confirm');
    } catch (err) {
      console.error('[RfidPaymentPage] 查询错误:', err);
      setError(`❌ 查询失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 处理 RFID 输入回车
   */
  const handleRfidKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRfidSearch(rfidInput);
    }
  };

  /**
   * 验证金额
   */
  const validateAmount = () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效金额');
      return false;
    }

    const numAmount = parseFloat(amount);
    const availablePoints = customerData?.customer?.pointsAccount?.availablePoints || 0;

    if (numAmount > availablePoints) {
      setError(`❌ 余额不足。当前余额：${availablePoints} 点`);
      return false;
    }

    return true;
  };

  /**
   * 确认金额，进入 PIN 输入
   */
  const handleConfirmAmount = () => {
    if (!validateAmount()) {
      return;
    }

    setPendingTransaction({
      customerId: customerData.userId,
      rfidId: customerData.rfidCard.rfidId,
      amount: parseFloat(amount),
      customerName: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName,
      merchantName: merchant?.stallName
    });

    setStep('pin');
    setTransactionPin('');
    setPinError('');
  };

  /**
   * 执行 RFID 支付（PIN 验证后）
   */
  const handleExecutePayment = async (pin) => {
    console.log('[RfidPaymentPage] ========== 执行 RFID 支付 ==========');

    setLoading(true);
    setError(null);
    setPinError('');
    setStep('processing');

    try {
      console.log('[RfidPaymentPage] 调用 processRfidPayment...');

      const processRfidPayment = httpsCallable(functions, 'processRfidPayment');

      const result = await processRfidPayment({
        customerId: pendingTransaction.customerId,
        merchantId: merchant.id,
        rfidId: pendingTransaction.rfidId,
        amount: pendingTransaction.amount,
        organizationId: organizationId,
        eventId: eventId,
        transactionPin: pin
      });

      console.log('[RfidPaymentPage] 支付成功:', result.data);

      // 刷新统计数据
      if (refreshStats) {
        setTimeout(() => refreshStats(), 1000);
      }

      setStep('success');
      
      // 3秒后重置
      setTimeout(() => {
        setStep('rfid');
        setRfidInput('');
        setAmount('');
        setCustomerData(null);
        setPendingTransaction(null);
        setTransactionPin('');
      }, 3000);
    } catch (err) {
      console.error('[RfidPaymentPage] 支付错误:', err);

      if (err.code === 'INVALID_PIN') {
        setPinError('❌ 交易密码错误，请重试');
        setStep('pin');
      } else if (err.code === 'INSUFFICIENT_BALANCE') {
        setError('❌ 余额不足，支付失败');
        setStep('confirm');
      } else {
        setError(`❌ 支付失败: ${err.message || '未知错误'}`);
        setStep('error');
      }
    } finally {
      setLoading(false);
    }
  };

  // 返回首页
  const handleBackToDashboard = () => {
    navigate(`/merchant/${orgEventCode}/dashboard`);
  };

  const handleLogout = async () => {
    if (confirm('确定要登出吗？')) {
      try {
        await signOut(auth);
        navigate(`/login/${orgEventCode}`);
      } catch (logoutError) {
        console.error('[RfidPaymentPage] Logout error:', logoutError);
        window.mybazaarShowToast?.('登出失败');
      }
    }
  };

  if (merchantLoading) {
    return (
      <div className="rfid-page-container">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="rfid-page-wrapper">
      <DashboardHeader 
        title={merchant?.stallName || 'RFID 支付'}
        subtitle="Merchant RFID Payment"
        logoUrl={event?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || currentUser?.displayName || '商家'}
        userPhone={userProfile?.basicInfo?.phoneNumber || currentUser?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={refreshStats}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={currentMerchantRole}
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      <div className="rfid-page-content">
        {/* RFID 输入页面 */}
        {step === 'rfid' && (
          <div className="rfid-card">
            <div className="rfid-icon">🎫</div>
            <h2 className="rfid-title">RFID 卡支付</h2>
            <p className="rfid-subtitle">请刷卡或输入卡号</p>

            <div className="rfid-input-group">
              <input
                ref={rfidInputRef}
                type="text"
                value={rfidInput}
                onChange={(e) => {
                  setRfidInput(e.target.value);
                  setError(null);
                }}
                onKeyPress={handleRfidKeyPress}
                placeholder="请输入或刷卡"
                className="rfid-input"
                disabled={loading}
                autoFocus
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              onClick={() => handleRfidSearch(rfidInput)}
              className="btn-primary"
              disabled={loading || !rfidInput.trim()}
            >
              {loading ? '查询中...' : '查询'}
            </button>
          </div>
        )}

        {/* 确认金额页面 */}
        {step === 'confirm' && customerData && (
          <div className="confirm-card">
            {/* 客户信息 */}
            <div className="customer-info-section">
              <div className="customer-header">
                <div className="customer-name">
                  ✓ {customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName}
                </div>
                <div className="rfid-badge">
                  🎫 {customerData.rfidCard.cardNumber}
                </div>
              </div>

              {/* 余额卡 */}
              <div className="balance-card">
                <span className="balance-label">可用余额</span>
                <span className="balance-amount">
                  {customerData.customer?.pointsAccount?.availablePoints || 0} 点
                </span>
              </div>
            </div>

            {/* 金额表单 */}
            <PaymentAmountForm
              amount={amount}
              onAmountChange={(val) => {
                setAmount(val);
                setError(null);
              }}
              maxAmount={customerData.customer?.pointsAccount?.availablePoints || 0}
              error={error}
              onConfirm={handleConfirmAmount}
              onBack={() => {
                setStep('rfid');
                setCustomerData(null);
                setAmount('');
                setRfidInput('');
              }}
              loading={loading}
            />
          </div>
        )}

        {/* PIN 输入页面 */}
        {step === 'pin' && pendingTransaction && (
          <div className="pin-container">
            <PinInput
              onSubmit={handleExecutePayment}
              onCancel={() => {
                setStep('confirm');
                setTransactionPin('');
                setPinError('');
              }}
              title="请输入交易密码"
              description={`向 ${pendingTransaction.merchantName} 支付 ${pendingTransaction.amount} 点`}
              loading={loading}
            />
          </div>
        )}

        {/* 处理中页面 */}
        {step === 'processing' && (
          <div className="processing-container">
            <div className="spinner"></div>
            <p className="processing-text">支付处理中...</p>
            <p className="processing-subtext">请稍候，不要关闭页面</p>
          </div>
        )}

        {/* 成功页面 */}
        {step === 'success' && pendingTransaction && (
          <div className="success-container">
            <div className="success-icon">✅</div>
            <h2 className="success-title">支付成功！</h2>
            <div className="success-details">
              <p className="success-detail">
                <span className="detail-label">客户：</span>
                <span className="detail-value">{pendingTransaction.customerName}</span>
              </p>
              <p className="success-detail">
                <span className="detail-label">金额：</span>
                <span className="detail-value">{pendingTransaction.amount} 点</span>
              </p>
              <p className="success-detail">
                <span className="detail-label">RFID 卡号：</span>
                <span className="detail-value">{customerData.rfidCard.cardNumber}</span>
              </p>
            </div>
            <p className="success-subtext">3秒后自动返回...</p>
          </div>
        )}

        {/* 错误页面 */}
        {step === 'error' && (
          <div className="error-container">
            <div className="error-icon">❌</div>
            <h2 className="error-title">支付失败</h2>
            <p className="error-description">{error}</p>
            <button
              onClick={() => {
                setStep('confirm');
                setError(null);
              }}
              className="btn-primary"
            >
              返回重试
            </button>
          </div>
        )}

        {/* RFID 交易记录 */}
        {step === 'rfid' && (
          <div className="transactions-section">
            <h3 className="section-title">🎫 RFID 支付记录</h3>
            <MerchantTransactions
              merchant={merchant}
              organizationId={organizationId}
              eventId={eventId}
              userRole="merchantOwner"
              currentUserId={currentUser?.uid}
              filterByTransactionType="rfid_card_payment"
              showTransactionTypeLabel={true}
            />
          </div>
        )}
      </div>

      <DashboardFooter
        event={event}
        eventCode={eventId}
        showEventInfo={true}
      />
    </div>
  );
};

export default RfidPaymentPage;

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import QRScanner from '../../components/QRScanner';
import { useEvent } from '../../contexts/EventContext';

/**
 * 点数卡充值页面
 * 
 * 流程：
 * 1. 扫描点数卡QR Code
 * 2. 显示点数卡信息
 * 3. 确认充值
 * 4. 执行充值（卡片自动销毁）
 * 5. 充值成功
 */
const PointCardTopup = () => {
  const navigate = useNavigate();
  const { orgCode, eventCode, organizationId: ctxOrganizationId, eventId: ctxEventId } = useEvent();

  // 页面状态
  const [step, setStep] = useState('scan'); // scan | confirm | processing | success

  // 用户数据
  const [customerData, setCustomerData] = useState(null);
  const [orgEventCode, setOrgEventCode] = useState('');
  // 点数卡数据
  const [cardData, setCardData] = useState(null);

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
      const { organizationId: claimOrgId, eventId: claimEventId } = tokenResult.claims;
      const organizationId = ctxOrganizationId || claimOrgId;
      const eventId = ctxEventId || claimEventId;

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
        // ✅ 构建orgEventCode用于导航
        const fallbackOrg = organizationId?.replace('organization_', '') || '';
        const fallbackEvt = eventId?.replace('event_', '') || '';
        const code = orgCode && eventCode ? `${orgCode}-${eventCode}` : `${fallbackOrg}-${fallbackEvt}`;
        setOrgEventCode(code);
        console.log('[PointCardTopup] orgEventCode设置为:', code);
      }
    } catch (error) {
      console.error('[PointCardTopup] 加载Customer数据失败:', error);
      setError('加载失败：' + error.message);
    }
  };

  // 扫描成功
  const handleScanSuccess = async (qrData) => {
    console.log('[PointCardTopup] 扫描成功:', qrData);

    // 验证QR Code类型
    if (qrData.type !== 'POINT_CARD') {
      setError('QR Code类型错误，请扫描点数卡');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 读取点数卡数据
      const cardRef = doc(
        db,
        'organizations', qrData.organizationId,
        'events', qrData.eventId,
        'pointCards', qrData.cardId
      );

      const cardSnap = await getDoc(cardRef);

      if (!cardSnap.exists()) {
        throw new Error('点数卡不存在');
      }

      const card = cardSnap.data();

      // 检查卡片状态
      if (!card.status?.isActive) {
        throw new Error('点数卡已失效');
      }

      if (card.status?.isDestroyed) {
        throw new Error('点数卡已被使用');
      }

      if (card.status?.isExpired) {
        throw new Error('点数卡已过期');
      }

      if (card.status?.isEmpty || (card.balance?.current || 0) <= 0) {
        throw new Error('点数卡余额为零');
      }

      setCardData({
        ...card,
        cardId: qrData.cardId
      });

      setStep('confirm');

    } catch (error) {
      console.error('[PointCardTopup] 读取点数卡失败:', error);
      setError(error.message || '读取点数卡信息失败');
    } finally {
      setLoading(false);
    }
  };

  // 扫描错误
  const handleScanError = (error) => {
    setError(error);
  };

  // 确认充值
  const handleConfirmTopup = async () => {
    setStep('processing');
    setLoading(true);
    setError(null);

    try {
      const topupFromPointCard = httpsCallable(functions, 'topupFromPointCard');

      const result = await topupFromPointCard({
        cardId: cardData.cardId
      });

      console.log('[PointCardTopup] 充值成功:', result.data);

      setStep('success');

      // 3秒后返回主页
      setTimeout(() => {
        navigate(`/customer/${orgEventCode}/dashboard`);
      }, 3000);

    } catch (error) {
      console.error('[PointCardTopup] 充值失败:', error);
      setError(error.message || '充值失败');
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  // 返回扫描
  const handleBackToScan = () => {
    setStep('scan');
    setCardData(null);
    setError(null);
  };

  // 取消充值
  const handleCancel = () => {
    navigate(`/customer/${orgEventCode}/dashboard`);
  };

  // 格式化时间
  const formatDate = (timestamp) => {
    if (!timestamp) return '未知';
    const date = timestamp.toDate();
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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
        <h1 style={styles.title}>点数卡充值</h1>
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
            expectedType="POINT_CARD"
          />

          {/* 提示 */}
          <div style={styles.tips}>
            <p style={styles.tipTitle}>💡 充值提示：</p>
            <ul style={styles.tipList}>
              <li>扫描点数卡上的QR Code</li>
              <li>充值后点数卡将自动销毁</li>
              <li>请确保扫描的是您购买的点数卡</li>
              <li>充值记录可在"交易记录"中查看</li>
            </ul>
          </div>
        </div>
      )}

      {/* 步骤2：确认充值 */}
      {step === 'confirm' && cardData && (
        <div style={styles.content}>
          {/* 点数卡信息 */}
          <div style={styles.cardInfoCard}>
            <div style={styles.cardHeader}>
              <div style={styles.cardIcon}>🎫</div>
              <h2 style={styles.cardTitle}>点数卡</h2>
            </div>

            <div style={styles.cardBalance}>
              <p style={styles.cardBalanceLabel}>卡内余额</p>
              <p style={styles.cardBalanceAmount}>
                {cardData.balance?.current || 0}
                <span style={styles.cardBalanceUnit}>点</span>
              </p>
            </div>

            <div style={styles.cardDetails}>
              <div style={styles.cardDetailRow}>
                <span style={styles.cardDetailLabel}>卡号：</span>
                <span style={styles.cardDetailValue}>{cardData.cardNumber || '未设置'}</span>
              </div>
              <div style={styles.cardDetailRow}>
                <span style={styles.cardDetailLabel}>初始金额：</span>
                <span style={styles.cardDetailValue}>{cardData.balance?.initial || 0} 点</span>
              </div>
              <div style={styles.cardDetailRow}>
                <span style={styles.cardDetailLabel}>发行时间：</span>
                <span style={styles.cardDetailValue}>{formatDate(cardData.issuedAt)}</span>
              </div>
              {cardData.expiresAt && (
                <div style={styles.cardDetailRow}>
                  <span style={styles.cardDetailLabel}>有效期至：</span>
                  <span style={styles.cardDetailValue}>{formatDate(cardData.expiresAt)}</span>
                </div>
              )}
            </div>

            {/* 状态标签 */}
            <div style={styles.cardStatus}>
              {cardData.status?.isActive && (
                <span style={styles.statusBadge}>✅ 有效</span>
              )}
            </div>
          </div>

          {/* 当前余额 */}
          <div style={styles.currentBalanceCard}>
            <p style={styles.currentBalanceLabel}>您的当前余额</p>
            <p style={styles.currentBalanceAmount}>
              {customerData.customer?.pointsAccount?.availablePoints || 0} 点
            </p>
          </div>

          {/* 充值后余额 */}
          <div style={styles.afterTopupCard}>
            <p style={styles.afterTopupLabel}>充值后余额</p>
            <p style={styles.afterTopupAmount}>
              {(customerData.customer?.pointsAccount?.availablePoints || 0) +
                (cardData.balance?.current || 0)} 点
            </p>
          </div>

          {/* 警告 */}
          <div style={styles.warningCard}>
            <p style={styles.warningIcon}>⚠️</p>
            <div style={styles.warningContent}>
              <p style={styles.warningTitle}>重要提示</p>
              <p style={styles.warningText}>
                充值后，此点数卡将立即销毁且无法恢复。请确认这是您本人的点数卡。
              </p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div style={styles.actions}>
            <button
              onClick={handleBackToScan}
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
              onClick={handleConfirmTopup}
              disabled={loading}
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              {loading ? '处理中...' : '确认充值'}
            </button>
          </div>
        </div>
      )}

      {/* 步骤3：处理中 */}
      {step === 'processing' && (
        <div style={styles.processingContainer}>
          <div style={styles.spinner}></div>
          <p style={styles.processingText}>充值处理中...</p>
          <p style={styles.processingSubtext}>请稍候</p>
        </div>
      )}

      {/* 步骤4：成功 */}
      {step === 'success' && (
        <div style={styles.successContainer}>
          <div style={styles.successIcon}>✅</div>
          <h2 style={styles.successTitle}>充值成功！</h2>

          <div style={styles.successDetails}>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>充值金额：</span>
              <span style={styles.detailValue}>+{cardData.balance?.current || 0} 点</span>
            </p>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>当前余额：</span>
              <span style={styles.detailValue}>
                {(customerData.customer?.pointsAccount?.availablePoints || 0) +
                  (cardData.balance?.current || 0)} 点
              </span>
            </p>
            <p style={styles.successDetail}>
              <span style={styles.detailLabel}>卡片状态：</span>
              <span style={styles.detailValue}>已销毁</span>
            </p>
          </div>

          <div style={styles.successInfo}>
            <p style={styles.successInfoIcon}>🎉</p>
            <p style={styles.successInfoText}>
              点数卡已成功充值到您的账户，卡片已自动销毁。
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
  tips: {
    marginTop: '1.5rem',
    padding: '1rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
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
  cardInfoCard: {
    marginBottom: '1rem',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    position: 'relative'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  cardIcon: {
    fontSize: '2.5rem'
  },
  cardTitle: {
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333',
    margin: 0
  },
  cardBalance: {
    padding: '1.5rem',
    backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    background: 'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)',
    borderRadius: '12px',
    marginBottom: '1.5rem',
    textAlign: 'center'
  },
  cardBalanceLabel: {
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.9)',
    margin: '0 0 0.5rem 0'
  },
  cardBalanceAmount: {
    fontSize: '2.5rem',
    fontWeight: '700',
    color: '#fff',
    margin: 0
  },
  cardBalanceUnit: {
    fontSize: '1.2rem',
    marginLeft: '0.5rem'
  },
  cardDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  cardDetailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.75rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  cardDetailLabel: {
    fontSize: '0.9rem',
    color: '#666'
  },
  cardDetailValue: {
    fontSize: '0.9rem',
    fontWeight: '500',
    color: '#333'
  },
  cardStatus: {
    marginTop: '1rem',
    display: 'flex',
    gap: '0.5rem'
  },
  statusBadge: {
    padding: '0.25rem 0.75rem',
    fontSize: '0.8rem',
    backgroundColor: '#4CAF50',
    color: '#fff',
    borderRadius: '12px',
    fontWeight: '600'
  },
  currentBalanceCard: {
    marginBottom: '1rem',
    padding: '1rem 1.5rem',
    backgroundColor: '#f0f7ff',
    borderRadius: '8px',
    border: '1px solid #2196F3'
  },
  currentBalanceLabel: {
    fontSize: '0.9rem',
    color: '#666',
    margin: '0 0 0.25rem 0'
  },
  currentBalanceAmount: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#2196F3',
    margin: 0
  },
  afterTopupCard: {
    marginBottom: '1rem',
    padding: '1rem 1.5rem',
    backgroundColor: '#f1f8f4',
    borderRadius: '8px',
    border: '1px solid #4CAF50'
  },
  afterTopupLabel: {
    fontSize: '0.9rem',
    color: '#666',
    margin: '0 0 0.25rem 0'
  },
  afterTopupAmount: {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: '#4CAF50',
    margin: 0
  },
  warningCard: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '8px'
  },
  warningIcon: {
    fontSize: '1.5rem',
    margin: 0
  },
  warningContent: {
    flex: 1
  },
  warningTitle: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#856404',
    margin: '0 0 0.25rem 0'
  },
  warningText: {
    fontSize: '0.85rem',
    color: '#856404',
    margin: 0,
    lineHeight: '1.4'
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
  successInfo: {
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    backgroundColor: '#f1f8f4',
    border: '1px solid #4CAF50',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  successInfoIcon: {
    fontSize: '1.5rem',
    margin: 0
  },
  successInfoText: {
    flex: 1,
    fontSize: '0.85rem',
    color: '#2E7D32',
    margin: 0,
    lineHeight: '1.4'
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

export default PointCardTopup;


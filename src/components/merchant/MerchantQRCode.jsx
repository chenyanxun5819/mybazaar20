import { useState, useRef, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, Share2, Store, AlertCircle, Bell, CheckCircle, XCircle } from 'lucide-react';
import { db } from '../../config/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { 
  generateMerchantPaymentQR,
  downloadQRCode,
  shareQRCode
} from '../../utils/qrCodeGenerator';
import { formatAmount, maskPhoneNumber } from '../../services/transactionService';
import './MerchantQRCode.css';

/**
 * PendingPaymentCard - 待收点数卡片
 */
const PendingPaymentCard = ({ payment, onConfirm, onCancel, userRole }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(payment.id);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      await onCancel(payment.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pending-payment-card">
      <div className="pending-payment-info">
        <div className="pending-payment-customer">
          <p className="customer-name">{payment.customerName || '顾客'}</p>
          <p className="customer-phone">{maskPhoneNumber(payment.customerPhone)}</p>
        </div>
        <div className="pending-payment-amount">
          <span className="amount-value">{formatAmount(payment.amount)}</span>
          <span className="amount-unit">点</span>
        </div>
      </div>
      <div className="pending-payment-actions">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="confirm-btn"
        >
          <CheckCircle />
          {loading ? '处理中...' : '待收'}
        </button>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="cancel-btn"
        >
          <XCircle />
          取消
        </button>
      </div>
      <div className="pending-payment-time">
        {new Date(payment.timestamp?.toDate()).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        })}
      </div>
    </div>
  );
};

/**
 * MerchantQRCode - 商家收款 QR Code 组件
 * @param {Object} props
 * @param {Object} props.merchant - 商家资料
 * @param {string} props.organizationId - 组织 ID
 * @param {string} props.eventId - 活动 ID
 * @param {string} props.userRole - 用户角色 (merchantOwner | merchantAsist)
 */
const MerchantQRCode = ({ merchant, organizationId, eventId, userRole }) => {
  const [qrData, setQrData] = useState('');
  const [showShareError, setShowShareError] = useState(false);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [notification, setNotification] = useState(null);
  const canvasRef = useRef(null);

  // 生成 QR Code 资料
  useEffect(() => {
    if (!merchant?.id || !organizationId || !eventId) return;

    const data = generateMerchantPaymentQR(
      organizationId,
      eventId,
      merchant.id
    );
    setQrData(data);
  }, [merchant?.id, organizationId, eventId]);

  // ⭐ 实时监听待收点数（pending 交易）
  useEffect(() => {
    if (!merchant?.id || !organizationId || !eventId) return;

    const transactionsRef = collection(
      db, 
      'organizations', organizationId, 
      'events', eventId, 
      'transactions'
    );

    const q = query(
      transactionsRef,
      where('merchantId', '==', merchant.id),
      where('status', '==', 'pending'),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const payments = [];
      
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          // ⭐ 新的 pending 交易 - 显示通知
          const data = change.doc.data();
          showNotification({
            customerName: data.customerName || '顾客',
            amount: data.amount
          });
        }
      });

      snapshot.forEach((doc) => {
        payments.push({
          id: doc.id,
          ...doc.data()
        });
      });

      setPendingPayments(payments);
    }, (error) => {
      console.error('Error listening to pending payments:', error);
    });

    return () => unsubscribe();
  }, [merchant?.id, organizationId, eventId]);

  // 显示通知（5秒后消失）
  const showNotification = (data) => {
    setNotification(data);
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // 确认收款
  const handleConfirmPayment = async (transactionId) => {
    try {
      // TODO: 调用 Cloud Function: confirmMerchantPayment
      console.log('Confirming payment:', transactionId);
      
      // 临时实现 - 实际应该调用 Cloud Function
      alert('确认收款功能开发中...\n请等待 Cloud Function 部署完成');
      
      // const confirmPayment = httpsCallable(functions, 'confirmMerchantPayment');
      // await confirmPayment({
      //   organizationId,
      //   eventId,
      //   transactionId
      // });
    } catch (error) {
      console.error('Error confirming payment:', error);
      alert('确认收款失败：' + error.message);
    }
  };

  // 取消交易
  const handleCancelPayment = async (transactionId) => {
    try {
      const reason = prompt('请输入取消原因（可选）:');
      
      // TODO: 调用 Cloud Function: cancelMerchantPayment
      console.log('Cancelling payment:', transactionId, 'Reason:', reason);
      
      // 临时实现
      alert('取消交易功能开发中...\n请等待 Cloud Function 部署完成');
      
      // const cancelPayment = httpsCallable(functions, 'cancelMerchantPayment');
      // await cancelPayment({
      //   organizationId,
      //   eventId,
      //   transactionId,
      //   cancelReason: reason || undefined
      // });
    } catch (error) {
      console.error('Error cancelling payment:', error);
      alert('取消交易失败：' + error.message);
    }
  };

  // 下载 QR Code
  const handleDownload = () => {
    const canvas = canvasRef.current?.querySelector('canvas');
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }

    try {
      const filename = `${merchant.stallName || 'merchant'}-qr-code.png`;
      downloadQRCode(canvas, filename);
    } catch (error) {
      console.error('Download failed:', error);
      alert('下载失败，请稍后再试');
    }
  };

  // 分享 QR Code
  const handleShare = async () => {
    const canvas = canvasRef.current?.querySelector('canvas');
    if (!canvas) {
      console.error('Canvas not found');
      return;
    }

    try {
      await shareQRCode(canvas, merchant.stallName || '商家');
      setShowShareError(false);
    } catch (error) {
      console.error('Share failed:', error);
      if (error.message.includes('不支持分享功能')) {
        setShowShareError(true);
      } else {
        alert('分享失败，请稍后再试');
      }
    }
  };

  if (!qrData) {
    return (
      <div className="merchant-qr-loading">
        <div className="merchant-qr-loading-content">
          <AlertCircle className="merchant-qr-loading-icon" />
          <p className="merchant-qr-loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="merchant-qr-container">
      {/* ⭐ 实时通知（新的待收点数） */}
      {notification && (
        <div className="merchant-qr-notification">
          <Bell className="notification-icon" />
          <div className="notification-content">
            <p className="notification-title">新的付款请求</p>
            <p className="notification-text">
              {notification.customerName} 请求付款 {formatAmount(notification.amount)} 点
            </p>
          </div>
        </div>
      )}

      {/* 标题 */}
      <div className="merchant-qr-header">
        <div className="merchant-qr-icon">
          <Store />
        </div>
        <div className="merchant-qr-title">
          <h3>收款 QR Code</h3>
          <p>顾客扫描此码进行付款</p>
        </div>
      </div>

      {/* QR Code 显示区域 */}
      <div className="merchant-qr-display">
        <div className="merchant-qr-card">
          {/* QR Code */}
          <div ref={canvasRef} className="merchant-qr-code">
            <QRCodeCanvas
              value={qrData}
              size={240}
              level="H"
              includeMargin={true}
              imageSettings={{
                src: '/logo.png',
                x: undefined,
                y: undefined,
                height: 40,
                width: 40,
                excavate: true,
              }}
            />
          </div>

          {/* 商家资讯 */}
          <div className="merchant-qr-info">
            <h4>{merchant.stallName || '商家摊位'}</h4>
            {merchant.description && (
              <p className="merchant-qr-description">
                {merchant.description}
              </p>
            )}
            <p className="merchant-qr-instruction">
              请扫描 QR Code 付款
            </p>
          </div>
        </div>
      </div>

      {/* ⭐ 待收点数列表 */}
      {pendingPayments.length > 0 && (
        <div className="pending-payments-section">
          <div className="pending-payments-header">
            <h3>待收点数</h3>
            <span className="pending-count">{pendingPayments.length}</span>
          </div>
          <div className="pending-payments-list">
            {pendingPayments.map((payment) => (
              <PendingPaymentCard
                key={payment.id}
                payment={payment}
                onConfirm={handleConfirmPayment}
                onCancel={handleCancelPayment}
                userRole={userRole}
              />
            ))}
          </div>
        </div>
      )}

      {/* 提示讯息 */}
      <div className="merchant-qr-alert">
        <div className="merchant-qr-alert-content">
          <AlertCircle className="merchant-qr-alert-icon" />
          <div className="merchant-qr-alert-text">
            <p>使用说明：</p>
            <ul>
              <li>顾客使用手机扫描此 QR Code</li>
              <li>输入付款金额并确认</li>
              <li>在上方"待收点数"列表中点击"待收"完成交易</li>
              <li>交易完成后会即时显示在交易记录中</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="merchant-qr-actions">
        <button
          onClick={handleDownload}
          className="merchant-qr-btn download"
        >
          <Download />
          下载 QR Code
        </button>
        <button
          onClick={handleShare}
          className="merchant-qr-btn share"
        >
          <Share2 />
          分享
        </button>
      </div>

      {/* 分享错误提示 */}
      {showShareError && (
        <div className="merchant-qr-share-error">
          <p>
            您的浏览器不支持分享功能，请使用「下载 QR Code」功能后手动分享图片。
          </p>
        </div>
      )}

      {/* 技术资讯（仅开发时显示） */}
      {process.env.NODE_ENV === 'development' && (
        <details>
          <summary>技术资讯</summary>
          <div>
            <div>Merchant ID: {merchant.id}</div>
            <div>Event ID: {eventId}</div>
            <div>Org ID: {organizationId}</div>
            <div>User Role: {userRole}</div>
            <div>Pending Payments: {pendingPayments.length}</div>
          </div>
        </details>
      )}
    </div>
  );
};

export default MerchantQRCode;
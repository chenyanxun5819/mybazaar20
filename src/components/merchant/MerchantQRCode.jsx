import { useState, useRef, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, Share2, Store, AlertCircle } from 'lucide-react';
import { 
  generateMerchantPaymentQR,
  downloadQRCode,
  shareQRCode
} from '../../utils/qrCodeGenerator';
import './MerchantQRCode.css';

/**
 * MerchantQRCode - 商家收款 QR Code 组件
 * @param {Object} props
 * @param {Object} props.merchant - 商家资料
 * @param {string} props.organizationId - 组织 ID
 * @param {string} props.eventId - 活动 ID
 */
const MerchantQRCode = ({ merchant, organizationId, eventId }) => {
  const [qrData, setQrData] = useState('');
  const [showShareError, setShowShareError] = useState(false);
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
                src: '/logo.png', // 如果有 logo 可以加上
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

      {/* 提示讯息 */}
      <div className="merchant-qr-alert">
        <div className="merchant-qr-alert-content">
          <AlertCircle className="merchant-qr-alert-icon" />
          <div className="merchant-qr-alert-text">
            <p>使用说明：</p>
            <ul>
              <li>顾客使用手机扫描此 QR Code</li>
              <li>输入付款金额并确认</li>
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
          </div>
        </details>
      )}
    </div>
  );
};

export default MerchantQRCode;

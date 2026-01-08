import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * QR Code显示组件
 * 
 * 功能：
 * - 生成QR Code
 * - 显示用户信息
 * - 支持下载和分享
 * 
 * @param {Object} props
 * @param {Object} props.qrData - QR Code数据对象
 * @param {string} props.userName - 用户名称
 * @param {string} props.subtitle - 副标题
 * @param {string} props.size - QR Code大小（small/medium/large）
 */
const QRCodeDisplay = ({ qrData, userName, subtitle, size = 'medium' }) => {
  const canvasRef = useRef(null);
  const [qrGenerated, setQrGenerated] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // QR Code尺寸映射
  const sizeMap = {
    small: 200,
    medium: 300,
    large: 400
  };

  const qrSize = sizeMap[size] || sizeMap.medium;

  useEffect(() => {
    if (qrData && canvasRef.current) {
      generateQRCode();
    }
  }, [qrData, qrSize]);

  // 生成QR Code
  const generateQRCode = async () => {
    try {
      const qrString = JSON.stringify(qrData);
      
      await QRCode.toCanvas(canvasRef.current, qrString, {
        width: qrSize,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });

      setQrGenerated(true);
      console.log('[QRCodeDisplay] QR Code生成成功');
    } catch (error) {
      console.error('[QRCodeDisplay] QR Code生成失败:', error);
      setQrGenerated(false);
    }
  };

  // 下载QR Code
  const handleDownload = async () => {
    if (!canvasRef.current) return;

    setDownloading(true);

    try {
      const canvas = canvasRef.current;
      const link = document.createElement('a');
      const fileName = `qr-code-${userName || 'customer'}-${Date.now()}.png`;
      
      link.download = fileName;
      link.href = canvas.toDataURL('image/png');
      link.click();

      console.log('[QRCodeDisplay] QR Code下载成功:', fileName);
    } catch (error) {
      console.error('[QRCodeDisplay] QR Code下载失败:', error);
      alert('下载失败，请重试');
    } finally {
      setDownloading(false);
    }
  };

  // 分享QR Code（如果支持）
  const handleShare = async () => {
    if (!canvasRef.current) return;

    try {
      const canvas = canvasRef.current;
      
      // 将canvas转换为blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error('无法生成图片');
        }

        const file = new File([blob], `qr-code-${userName}.png`, { type: 'image/png' });

        // 检查是否支持Web Share API
        if (navigator.share) {
          await navigator.share({
            files: [file],
            title: `${userName}的收款QR Code`,
            text: '扫描此QR Code进行付款'
          });
          console.log('[QRCodeDisplay] QR Code分享成功');
        } else {
          // 回退到下载
          handleDownload();
        }
      }, 'image/png');
    } catch (error) {
      console.error('[QRCodeDisplay] QR Code分享失败:', error);
      alert('分享失败，请尝试下载');
    }
  };

  // 刷新QR Code
  const handleRefresh = () => {
    generateQRCode();
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* 头部信息 */}
        <div style={styles.header}>
          <div style={styles.userInfo}>
            <div style={styles.avatar}>
              {userName ? userName.charAt(0).toUpperCase() : '?'}
            </div>
            <div>
              <h3 style={styles.userName}>{userName || '未命名用户'}</h3>
              {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
            </div>
          </div>
        </div>

        {/* QR Code容器 */}
        <div style={styles.qrContainer}>
          {!qrGenerated && (
            <div style={styles.loading}>
              <div style={styles.spinner}></div>
              <p style={styles.loadingText}>生成中...</p>
            </div>
          )}
          
          <canvas
            ref={canvasRef}
            style={{
              ...styles.qrCanvas,
              display: qrGenerated ? 'block' : 'none'
            }}
          />
        </div>

        {/* 说明文字 */}
        <div style={styles.description}>
          <p style={styles.descriptionText}>
            {qrData?.type === 'CUSTOMER_RECEIVE_POINTS' && '扫描此QR Code向我转账点数'}
            {qrData?.type === 'MERCHANT' && '扫描此QR Code向商家付款'}
            {qrData?.type === 'POINT_CARD' && '扫描此QR Code使用点数卡'}
            {!qrData?.type && '扫描此QR Code'}
          </p>
        </div>

        {/* 操作按钮 */}
        <div style={styles.actions}>
          <button
            onClick={handleDownload}
            disabled={!qrGenerated || downloading}
            style={{
              ...styles.button,
              ...styles.primaryButton,
              ...((!qrGenerated || downloading) ? styles.buttonDisabled : {})
            }}
          >
            <span style={styles.buttonIcon}>📥</span>
            {downloading ? '下载中...' : '下载QR Code'}
          </button>

          {navigator.share && (
            <button
              onClick={handleShare}
              disabled={!qrGenerated}
              style={{
                ...styles.button,
                ...styles.secondaryButton,
                ...(!qrGenerated ? styles.buttonDisabled : {})
              }}
            >
              <span style={styles.buttonIcon}>📤</span>
              分享
            </button>
          )}

          <button
            onClick={handleRefresh}
            disabled={!qrGenerated}
            style={{
              ...styles.button,
              ...styles.secondaryButton,
              ...(!qrGenerated ? styles.buttonDisabled : {})
            }}
          >
            <span style={styles.buttonIcon}>🔄</span>
            刷新
          </button>
        </div>

        {/* QR Code信息 */}
        {qrData && (
          <div style={styles.info}>
            <details style={styles.details}>
              <summary style={styles.detailsSummary}>查看技术详情</summary>
              <div style={styles.detailsContent}>
                <table style={styles.infoTable}>
                  <tbody>
                    <tr>
                      <td style={styles.infoLabel}>类型:</td>
                      <td style={styles.infoValue}>{qrData.type}</td>
                    </tr>
                    <tr>
                      <td style={styles.infoLabel}>版本:</td>
                      <td style={styles.infoValue}>{qrData.version}</td>
                    </tr>
                    <tr>
                      <td style={styles.infoLabel}>用户ID:</td>
                      <td style={styles.infoValue}>{qrData.userId}</td>
                    </tr>
                    {qrData.generatedAt && (
                      <tr>
                        <td style={styles.infoLabel}>生成时间:</td>
                        <td style={styles.infoValue}>
                          {new Date().toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    maxWidth: '500px',
    margin: '0 auto'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  header: {
    marginBottom: '1.5rem'
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  avatar: {
    width: '50px',
    height: '50px',
    borderRadius: '50%',
    backgroundColor: '#2196F3',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: '600'
  },
  userName: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 0.25rem 0'
  },
  subtitle: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  qrContainer: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    marginBottom: '1rem',
    minHeight: '320px'
  },
  qrCanvas: {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '8px'
  },
  loading: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #2196F3',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    marginTop: '1rem',
    color: '#666',
    fontSize: '0.9rem'
  },
  description: {
    textAlign: 'center',
    marginBottom: '1.5rem',
    padding: '0.75rem',
    backgroundColor: '#f0f7ff',
    borderRadius: '8px'
  },
  descriptionText: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#1976D2',
    fontWeight: '500'
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginBottom: '1rem'
  },
  button: {
    flex: 1,
    minWidth: '120px',
    padding: '0.75rem 1rem',
    fontSize: '0.9rem',
    fontWeight: '500',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
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
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  buttonIcon: {
    fontSize: '1.1rem'
  },
  info: {
    marginTop: '1rem'
  },
  details: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '0.75rem'
  },
  detailsSummary: {
    fontSize: '0.85rem',
    color: '#666',
    cursor: 'pointer',
    fontWeight: '500',
    userSelect: 'none'
  },
  detailsContent: {
    marginTop: '0.75rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid #dee2e6'
  },
  infoTable: {
    width: '100%',
    fontSize: '0.8rem'
  },
  infoLabel: {
    color: '#666',
    paddingRight: '1rem',
    verticalAlign: 'top',
    width: '80px'
  },
  infoValue: {
    color: '#333',
    fontFamily: 'monospace',
    wordBreak: 'break-all'
  }
};

// 添加旋转动画
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

export default QRCodeDisplay;

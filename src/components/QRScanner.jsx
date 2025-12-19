import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats, Html5QrcodeScanType } from 'html5-qrcode';

/**
 * QR扫描组件
 * 
 * 功能：
 * - 调用摄像头扫描QR Code
 * - 支持文件上传扫描
 * - 自动解析QR Code数据
 * 
 * @param {Object} props
 * @param {Function} props.onScan - 扫描成功回调
 * @param {Function} props.onError - 扫描错误回调
 * @param {string} props.expectedType - 期待的QR Code类型（可选）
 */
const QRScanner = ({ onScan, onError, expectedType = null, autoStart = false }) => {
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, setCameraPermission] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const scannerRef = useRef(null);
  const qrScannerRef = useRef(null);

  // 添加调试日志到状态
  const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-19), `[${timestamp}] ${message}`]);
    console.log(message);
  };

  useEffect(() => {
    // 检查摄像头权限
    checkCameraPermission();

    return () => {
      // 清理扫描器
      if (qrScannerRef.current) {
        qrScannerRef.current.clear().catch(console.error);
      }
    };
  }, []);

  // 检查摄像头权限
  const checkCameraPermission = async () => {
    try {
      addDebugLog('检查摄像头权限...');
      addDebugLog(`navigator.mediaDevices 存在? ${!!navigator.mediaDevices}`);
      addDebugLog(`getUserMedia 存在? ${!!navigator.mediaDevices?.getUserMedia}`);
      
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      addDebugLog('✅ 摄像头权限检查成功');
      stream.getTracks().forEach(track => track.stop());
      setCameraPermission('granted');
      // 若設為自動啟動，權限通過後直接開啟掃描
      if (autoStart) {
        addDebugLog('autoStart 生效，直接開始掃描');
        setScanning(true);
      }
    } catch (error) {
      addDebugLog(`❌ 摄像头权限检查失败: ${error.name}`);
      addDebugLog(`错误信息: ${error.message}`);
      addDebugLog(`错误代码: ${error.code}`);
      setCameraPermission('denied');
    }
  };

  // 扫描成功處理（供掃描器回調使用）
  const handleScanSuccess = (decodedText) => {
    console.log('[QRScanner] 扫描成功:', decodedText);
    try {
      const qrData = JSON.parse(decodedText);
      if (expectedType && qrData.type !== expectedType) {
        throw new Error(`QR Code类型不匹配。期待：${expectedType}，实际：${qrData.type}`);
      }
      stopScanning();
      onScan(qrData);
    } catch (error) {
      console.error('[QRScanner] 解析失败:', error);
      if (onError) {
        onError(error.message || '无效的QR Code格式');
      }
    }
  };

  const handleScanFailure = (_error) => {
    // 靜默忽略逐幀失敗
  };

  // 开始扫描
  const startScanning = () => {
    addDebugLog('🟢 开始扫描方法被调用');
    setScanning(true);
  };

  // 當 scanning=true 時，等待 DOM 出現後初始化掃描器
  useEffect(() => {
    if (!scanning) return;

    const init = () => {
      const el = document.getElementById('qr-reader');
      if (!el) {
        addDebugLog('⚠️ qr-reader 容器尚未渲染，100ms 后重试');
        setTimeout(init, 100);
        return;
      }
      try {
        addDebugLog('正在创建 Html5QrcodeScanner...');
        qrScannerRef.current = new Html5QrcodeScanner(
          'qr-reader',
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            showTorchButtonIfSupported: true,
            showZoomSliderIfSupported: true,
            // 僅啟用相機掃描並隱藏圖片上傳 UI
            supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
            showImageUploadUI: false,
            rememberLastUsedCamera: true,
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            videoConstraints: { facingMode: 'environment' }
          },
          true
        );
        addDebugLog('✅ Html5QrcodeScanner 创建成功');
        addDebugLog('正在调用 render()...');
        qrScannerRef.current.render(handleScanSuccess, handleScanFailure);
        addDebugLog('✅ render() 成功，相机應該啟動');
      } catch (error) {
        addDebugLog(`❌ 创建或渲染失败: ${error?.message || error}`);
        setScanning(false);
      }
    };

    init();
  }, [scanning]);

  // 停止扫描
  const stopScanning = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.clear().catch(console.error);
      qrScannerRef.current = null;
    }
    setScanning(false);
  };

  // 请求摄像头权限
  const requestCameraPermission = async () => {
    try {
      const constraints = {
        video: {
          facingMode: 'environment', // 优先后置摄像头（手机）
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(track => track.stop());
      setCameraPermission('granted');
      if (autoStart) {
        setScanning(true);
      } else {
        startScanning();
      }
    } catch (error) {
      console.error('[QRScanner] 摄像头权限请求失败:', error);
      console.error('[QRScanner] 错误名称:', error.name);
      console.error('[QRScanner] 错误信息:', error.message);
      
      setCameraPermission('denied');
      
      // 根据不同的错误类型提供具体的错误信息
      let errorMessage = '无法访问摄像头';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = '❌ 摄像头权限被拒绝。请在浏览器设置中允许访问摄像头，然后重新加载页面。';
      } else if (error.name === 'NotFoundError') {
        errorMessage = '❌ 设备上找不到摄像头。请确保您的设备有摄像头。';
      } else if (error.name === 'NotReadableError') {
        errorMessage = '❌ 摄像头被其他应用占用。请关闭其他使用摄像头的应用后重试。';
      } else if (error.name === 'SecurityError') {
        errorMessage = '❌ 由于安全限制无法访问摄像头。请在 HTTPS 连接下使用此功能。';
      } else if (error.name === 'TypeError') {
        errorMessage = '❌ 浏览器不支持摄像头访问，或者此页面缺少必要的权限。';
      }
      
      if (onError) {
        onError(errorMessage);
      }
    }
  };

  return (
    <div style={styles.container}>
      {!scanning ? (
        <div style={styles.startContainer}>
          <div style={styles.iconContainer}>
            <svg
              style={styles.icon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
          </div>

          <h3 style={styles.title}>扫描QR Code</h3>
          
          {cameraPermission === 'denied' && (
            <div style={styles.alert}>
              <p style={styles.alertText}>
                ⚠️ 无法访问摄像头，请检查浏览器权限设置
              </p>
            </div>
          )}

          <div style={styles.instructions}>
            <p style={styles.instructionText}>
              {expectedType === 'MERCHANT' && '请扫描商家收款QR Code'}
              {expectedType === 'POINT_CARD' && '请扫描点数卡QR Code'}
              {expectedType === 'CUSTOMER_RECEIVE_POINTS' && '请扫描Customer收款QR Code'}
              {!expectedType && '请将QR Code对准摄像头'}
            </p>
          </div>

          <button
            onClick={cameraPermission === 'granted' ? startScanning : requestCameraPermission}
            style={styles.startButton}
          >
            <span style={styles.buttonIcon}>📷</span>
            {cameraPermission === 'granted' ? '开始扫描' : '允许摄像头访问'}
          </button>

          <div style={styles.tips}>
            <p style={styles.tipTitle}>💡 扫描提示：</p>
            <ul style={styles.tipList}>
              <li>确保QR Code在扫描框内</li>
              <li>保持摄像头稳定和焦距清晰</li>
              <li>确保光线充足</li>
              <li>也可以上传QR Code图片</li>
            </ul>
          </div>
        </div>
      ) : (
        <div style={styles.scannerContainer}>
          <div style={styles.scannerHeader}>
            <h3 style={styles.scannerTitle}>正在扫描...</h3>
            <button onClick={stopScanning} style={styles.cancelButton}>
              取消
            </button>
          </div>

          {/* QR扫描器容器 */}
          <div id="qr-reader" style={styles.readerContainer}></div>

          <div style={styles.scannerTips}>
            <p style={styles.scannerTipText}>
              请将QR Code对准摄像头中央的方框
            </p>
          </div>
        </div>
      )}

      {/* 调试面板 */}
      <div style={styles.debugToggle}>
        <button 
          onClick={() => setShowDebug(!showDebug)}
          style={styles.debugToggleButton}
        >
          🐛 调试日志 ({debugLogs.length})
        </button>
      </div>

      {showDebug && (
        <div style={styles.debugPanel}>
          <div style={styles.debugHeader}>
            <h4 style={styles.debugTitle}>实时调试日志</h4>
            <button 
              onClick={() => setDebugLogs([])}
              style={styles.debugClearButton}
            >
              清空
            </button>
          </div>
          <div style={styles.debugContent}>
            {debugLogs.length === 0 ? (
              <div style={styles.debugEmpty}>没有日志</div>
            ) : (
              debugLogs.map((log, index) => (
                <div key={index} style={styles.debugLine}>
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    maxWidth: '500px',
    margin: '0 auto'
  },
  startContainer: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    textAlign: 'center'
  },
  iconContainer: {
    width: '80px',
    height: '80px',
    margin: '0 auto 1.5rem',
    backgroundColor: '#f0f7ff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  icon: {
    width: '40px',
    height: '40px',
    color: '#2196F3'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '1rem'
  },
  alert: {
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '8px',
    padding: '1rem',
    marginBottom: '1rem'
  },
  alertText: {
    margin: 0,
    color: '#856404',
    fontSize: '0.9rem'
  },
  instructions: {
    marginBottom: '1.5rem'
  },
  instructionText: {
    fontSize: '1rem',
    color: '#666',
    margin: 0
  },
  startButton: {
    width: '100%',
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '600',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    marginBottom: '1.5rem'
  },
  buttonIcon: {
    fontSize: '1.2rem'
  },
  tips: {
    backgroundColor: '#f8f9fa',
    padding: '1rem',
    borderRadius: '8px',
    textAlign: 'left'
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
  scannerContainer: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  scannerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  scannerTitle: {
    fontSize: '1.2rem',
    fontWeight: '600',
    color: '#333',
    margin: 0
  },
  cancelButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    backgroundColor: '#fff',
    color: '#f44336',
    border: '1px solid #f44336',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  readerContainer: {
    width: '100%',
    marginBottom: '1rem'
  },
  scannerTips: {
    backgroundColor: '#f8f9fa',
    padding: '0.75rem',
    borderRadius: '8px',
    textAlign: 'center'
  },
  scannerTipText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#666'
  },
  debugToggle: {
    marginTop: '1rem',
    textAlign: 'center'
  },
  debugToggleButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.85rem',
    backgroundColor: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'monospace'
  },
  debugPanel: {
    marginTop: '1rem',
    backgroundColor: '#1e1e1e',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
  },
  debugHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2d2d2d',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #444'
  },
  debugTitle: {
    margin: 0,
    color: '#fff',
    fontSize: '0.9rem',
    fontWeight: '600'
  },
  debugClearButton: {
    padding: '0.25rem 0.75rem',
    fontSize: '0.8rem',
    backgroundColor: '#f44336',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  debugContent: {
    maxHeight: '300px',
    overflowY: 'auto',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    padding: '0.75rem'
  },
  debugLine: {
    color: '#4ade80',
    marginBottom: '0.25rem',
    wordBreak: 'break-all',
    lineHeight: '1.4'
  },
  debugEmpty: {
    color: '#888',
    textAlign: 'center',
    padding: '1rem'
  }
};

export default QRScanner;
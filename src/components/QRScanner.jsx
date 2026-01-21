import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

/**
 * QR扫描组件 - 完全简化版
 * 
 * ✅ 修复：
 * 1. 隐藏所有 html5-qrcode 的控制按钮
 * 2. 直接使用后置相机，无选项
 * 3. 自动开始扫描
 */
const QRScanner = ({ onScanSuccess, onScanError, expectedType = null, autoStart = false, helpText }) => {
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, setCameraPermission] = useState(null);
  const [debugLogs, setDebugLogs] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const qrScannerRef = useRef(null);

  const addDebugLog = (message) => {
    try {
      const timestamp = new Date().toLocaleTimeString();
      const logMsg = `[${timestamp}] ${message}`;
      setDebugLogs(prev => [...prev.slice(-19), logMsg]);
      console.log('[QRScanner]', message);
    } catch (error) {
      console.error('[QRScanner] 添加日志失败:', error);
    }
  };

  useEffect(() => {
    checkCameraPermission();
    return () => {
      if (qrScannerRef.current) {
        try {
          // 兼容直接模式：若存在 stop() 先停止，再清理
          if (typeof qrScannerRef.current.stop === 'function') {
            try {
              qrScannerRef.current.stop();
            } catch (e) {
              console.warn('[QRScanner] stop() 失敗，改用 clear():', e?.message);
            }
          }
          qrScannerRef.current.clear?.();
        } catch (e) {
          console.error('清理扫描器失败:', e);
        }
      }
    };
  }, []);

  const checkCameraPermission = async () => {
    try {
      addDebugLog('🔍 检查摄像头权限(不弹窗)...');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addDebugLog('❌ 浏览器不支持 getUserMedia');
        setCameraPermission('denied');
        return;
      }

      // 盡量使用 Permissions API（不會觸發權限彈窗）
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
          const status = await navigator.permissions.query({ name: 'camera' });
          addDebugLog(`🔐 camera permission state: ${status.state}`);
          setCameraPermission(status.state); // 'granted' | 'prompt' | 'denied'
          status.onchange = () => {
            addDebugLog(`🔐 camera permission changed: ${status.state}`);
            setCameraPermission(status.state);
          };
        } catch (e) {
          // 某些瀏覽器（尤其 iOS Safari）可能不支援 camera query
          addDebugLog('⚠️ Permissions API 不支援 camera，改用 prompt 狀態');
          setCameraPermission('prompt');
        }
      } else {
        setCameraPermission('prompt');
      }

      if (autoStart) {
        addDebugLog('⚡ autoStart=true，直接启动扫描（只会请求一次权限）');
        setTimeout(() => {
          setScanning(true);
        }, 50);
      }
    } catch (error) {
      addDebugLog(`❌ 权限状态检查失败: ${error.name} - ${error.message}`);
      setCameraPermission('prompt');
    }
  };

  const validateQRType = (qrType) => {
    if (!expectedType) {
      return true;
    }

    const normalize = (str) => String(str || '').toLowerCase().trim();
    const qrTypeNorm = normalize(qrType);
    
    if (Array.isArray(expectedType)) {
      const isValid = expectedType.some(type => normalize(type) === qrTypeNorm);
      if (!isValid) {
        const expected = expectedType.map(t => String(t)).join(' 或 ');
        throw new Error(`QR Code类型不匹配。期待：${expected}，实际：${qrType || '未知'}`);
      }
      return true;
    } else {
      if (normalize(expectedType) !== qrTypeNorm) {
        throw new Error(`QR Code类型不匹配。期待：${expectedType}，实际：${qrType || '未知'}`);
      }
      return true;
    }
  };

  const handleScanSuccess = (decodedText) => {
    try {
      addDebugLog('📸 扫描到内容');
      
      if (!decodedText) {
        addDebugLog('❌ 扫描内容为空');
        if (onScanError) onScanError('扫描到的数据为空');
        return;
      }

      const preview = decodedText.length > 50 ? decodedText.substring(0, 50) + '...' : decodedText;
      addDebugLog(`📄 数据预览: ${preview}`);
      
      let qrData;
      try {
        qrData = JSON.parse(decodedText);
        addDebugLog(`✅ JSON解析成功`);
      } catch (parseError) {
        addDebugLog(`❌ JSON解析失败: ${parseError.message}`);
        throw new Error('无效的QR Code格式（非JSON）');
      }

      const qrType = qrData?.type || '未知';
      addDebugLog(`🏷️ QR Code类型: ${qrType}`);
      
      try {
        validateQRType(qrType);
        addDebugLog('✅ 类型验证通过');
      } catch (typeError) {
        addDebugLog(`❌ ${typeError.message}`);
        throw typeError;
      }
      
      addDebugLog('🛑 停止扫描');
      stopScanning();
      
      addDebugLog('📤 调用 onScanSuccess');
      if (onScanSuccess) {
        onScanSuccess(qrData);
      }
      
    } catch (error) {
      const errorMessage = error?.message || '扫描处理失败';
      addDebugLog(`❌ 处理失败: ${errorMessage}`);
      if (onScanError) {
        onScanError(errorMessage);
      }
    }
  };

  const handleScanFailure = (error) => {
    // 忽略逐帧扫描失败
  };

  const startScanning = () => {
    addDebugLog('🟢 startScanning() 被调用');
    setScanning(true);
  };

  useEffect(() => {
    if (!scanning) {
      addDebugLog('⏸️ scanning=false，不初始化扫描器');
      return;
    }

    addDebugLog('🎬 scanning=true，开始初始化（直接模式，避免二次权限弹窗）...');

    const init = () => {
      const el = document.getElementById('qr-reader');
      if (!el) {
        addDebugLog('⚠️ #qr-reader 元素未找到，100ms后重试');
        setTimeout(init, 100);
        return;
      }

      // 每次開始前先清乾淨
      if (qrScannerRef.current) {
        try {
          qrScannerRef.current.stop?.();
          qrScannerRef.current.clear?.();
        } catch (_) {}
        qrScannerRef.current = null;
      }

      try {
        initDirectHtml5qrcode();
      } catch (error) {
        addDebugLog(`❌ 初始化失败: ${error?.message || error}`);
        setScanning(false);
        if (onScanError) onScanError(`扫描器初始化失败: ${error?.message || error}`);
      }
    };

    init();
  }, [scanning]);

  // ✅ 隐藏 html5-qrcode 的所有控制按钮
  const hideHtml5QrcodeButtons = () => {
    try {
      addDebugLog('🎨 开始隐藏控制按钮...');
      
      // 隐藏所有按钮
      const buttons = document.querySelectorAll('#qr-reader button');
      buttons.forEach(btn => {
        const text = btn.textContent.toLowerCase();
        // 隐藏 Start Scanning, Stop Scanning, Select Camera 等按钮
        if (text.includes('start') || text.includes('stop') || text.includes('select') || 
            text.includes('camera') || text.includes('torch') || text.includes('switch')) {
          btn.style.display = 'none';
          addDebugLog(`🚫 隐藏按钮: ${btn.textContent}`);
        }
      });
      
      // 隐藏相机选择下拉框
      const selects = document.querySelectorAll('#qr-reader select');
      selects.forEach(select => {
        select.style.display = 'none';
        addDebugLog(`🚫 隐藏下拉框`);
      });
      
      // 隐藏可能的错误提示
      const errorDivs = document.querySelectorAll('#qr-reader div[style*="red"]');
      errorDivs.forEach(div => {
        div.style.display = 'none';
      });
      
      addDebugLog('✅ 控制按钮已隐藏');
    } catch (error) {
      addDebugLog(`⚠️ 隐藏按钮失败: ${error.message}`);
    }
  };

  const stopScanning = () => {
    addDebugLog('🛑 stopScanning() 被调用');
    if (qrScannerRef.current) {
      try {
        if (typeof qrScannerRef.current.stop === 'function') {
          // 直接模式（Html5Qrcode）需要先 stop()
          try {
            qrScannerRef.current.stop();
            addDebugLog('✅ stop() 成功');
          } catch (e) {
            addDebugLog(`⚠️ stop() 失败: ${e.message}`);
          }
        }
        qrScannerRef.current.clear?.();
        addDebugLog('✅ 扫描器已清理');
      } catch (e) {
        addDebugLog(`⚠️ 清理扫描器失败: ${e.message}`);
      }
      qrScannerRef.current = null;
    }
    setScanning(false);
  };

  // 🔁 直接模式回退：避開 Scanner 包裝的 UI 與某些瀏覽器 Bug
  const initDirectHtml5qrcode = () => {
    const el = document.getElementById('qr-reader');
    if (!el) {
      throw new Error('#qr-reader 元素未找到');
    }

    addDebugLog('🧩 使用直接模式初始化 Html5Qrcode...');
    const html5Qr = new Html5Qrcode('qr-reader');
    qrScannerRef.current = html5Qr;

    const constraints = { facingMode: 'environment' }; // 避免 exact，增加兼容性
    const config = {
      fps: 10,
      disableFlip: true,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    };

    addDebugLog(`🛠️ 直接模式配置: ${JSON.stringify({ constraints, config })}`);

    return html5Qr.start(
      constraints,
      config,
      handleScanSuccess,
      handleScanFailure
    ).then(() => {
      addDebugLog('✅ 直接模式啟動成功，攝像頭應該已打開');
      setCameraPermission('granted');
    }).catch((e) => {
      const name = e?.name || '';
      addDebugLog(`❌ 直接模式啟動失敗: ${name} ${e?.message || e}`);
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraPermission('denied');
      }
      throw e;
    });
  };

  const requestCameraPermission = async () => {
    // ⚠️ 不在這裡先 getUserMedia()，避免「先預檢一次、掃描再請求一次」造成雙重彈窗。
    // 讓 Html5Qrcode.start() 來做唯一一次的權限請求。
    addDebugLog('🔐 准备启动扫描（将由掃描器请求一次摄像头权限）...');
    setCameraPermission('prompt');
    startScanning();
  };

  const getInstructionText = () => {
    if (helpText) return helpText;
    return '请将商家的收款QR Code对准摄像头';
  };

  return (
    <div style={styles.container}>
      {!scanning ? (
        <div style={styles.startContainer}>
          <div style={styles.iconContainer}>
            <svg style={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>

          <h3 style={styles.title}>扫描QR Code</h3>
          
          {cameraPermission === 'denied' && (
            <div style={styles.alert}>
              <p style={styles.alertText}>⚠️ 无法访问摄像头，请检查浏览器权限设置</p>
            </div>
          )}

          <div style={styles.instructions}>
            <p style={styles.instructionText}>{getInstructionText()}</p>
          </div>

          <button
            onClick={requestCameraPermission}
            style={styles.startButton}
          >
            <span style={styles.buttonIcon}>📷</span>
            允许使用后置摄像头
          </button>
        </div>
      ) : (
        <div style={styles.scannerContainer}>
          <div style={styles.scannerHeader}>
            <h3 style={styles.scannerTitle}>请对准QR Code</h3>
            <button onClick={stopScanning} style={styles.cancelButton}>取消</button>
          </div>

          {/* ✅ QR 扫描器容器 */}
          <div id="qr-reader" style={styles.readerContainer}></div>

          <div style={styles.scannerTips}>
            <p style={styles.scannerTipText}>{getInstructionText()}</p>
          </div>
        </div>
      )}

      {/* 调试面板 */}
      <div style={styles.debugPanel}>
        <div style={styles.debugHeader}>
          <h4 style={styles.debugTitle}>🐛 调试日志</h4>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => setDebugLogs([])} style={styles.debugClearButton}>清空</button>
            <button onClick={() => setShowDebug(!showDebug)} style={styles.debugToggleButton}>
              {showDebug ? '隐藏' : '显示'}
            </button>
          </div>
        </div>
        {showDebug && (
          <div style={styles.debugContent}>
            {debugLogs.length === 0 ? (
              <div style={styles.debugEmpty}>没有日志</div>
            ) : (
              debugLogs.map((log, index) => (
                <div key={index} style={styles.debugLine}>{log}</div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ✅ 添加CSS来隐藏按钮 */}
      <style>{`
        /* 隐藏 html5-qrcode 的所有控制按钮 */
        #qr-reader button {
          display: none !important;
        }
        
        /* 隐藏相机选择下拉框 */
        #qr-reader select {
          display: none !important;
        }
        
        /* 隐藏红色错误提示 */
        #qr-reader div[style*="red"],
        #qr-reader div[style*="Red"],
        #qr-reader div[style*="color: rgb(255, 0, 0)"] {
          display: none !important;
        }
        
        /* 隐藏 "Select Camera" 文字 */
        #qr-reader__dashboard_section_csr,
        #qr-reader__dashboard_section {
          display: none !important;
        }
        
        /* 只显示视频和扫描框 */
        #qr-reader video {
          display: block !important;
        }
        
        #qr-reader__scan_region {
          display: block !important;
        }
      `}</style>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  },
  buttonIcon: {
    fontSize: '1.2rem'
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
    cursor: 'pointer'
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
  debugToggleButton: {
    padding: '0.25rem 0.75rem',
    fontSize: '0.8rem',
    backgroundColor: '#4CAF50',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
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


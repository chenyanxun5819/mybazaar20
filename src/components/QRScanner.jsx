import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';

/**
 * QR扫描组件 - 完全简化版
 * 
 * ✅ 修复：
 * 1. 隐藏所有 html5-qrcode 的控制按钮
 * 2. 直接使用后置相机，无选项
 * 3. 自动开始扫描
 */
const QRScanner = ({ onScanSuccess, onScanError, expectedType = null, autoStart = false, helpText, allowRawText = false }) => {
  const [scanning, setScanning] = useState(autoStart); // ⭐ 如果 autoStart=true，初始就开始扫描
  const [cameraPermission, setCameraPermission] = useState(null);
  const qrScannerRef = useRef(null);

  const stopScanning = async ({ keepScanningState = false } = {}) => {
    const scanner = qrScannerRef.current;
    qrScannerRef.current = null;

    if (scanner) {
      let canClear = true;

      try {
        const state = typeof scanner.getState === 'function'
          ? scanner.getState()
          : Html5QrcodeScannerState.UNKNOWN;

        if (typeof scanner.stop === 'function' && state !== Html5QrcodeScannerState.NOT_STARTED) {
          try {
            await scanner.stop();
          } catch (e) {
            canClear = false;
          }
        }

        if (canClear) {
          try {
            scanner.clear?.();
          } catch (e) {
            const clearMessage = e?.message || String(e);
            if (!/Cannot clear while scan is ongoing/i.test(clearMessage)) {
              // 继续处理
            }
          }
        }
      } catch (e) {
        // 扫描器清理失败，继续
      }
    }

    if (!keepScanningState) {
      setScanning(false);
    }
  };

  useEffect(() => {
    checkCameraPermission();
    return () => {
      void stopScanning({ keepScanningState: true });
    };
  }, []);

  const checkCameraPermission = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraPermission('denied');
        return;
      }

      // 盡量使用 Permissions API（不會觸發權限彈窗）
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        try {
          const status = await navigator.permissions.query({ name: 'camera' });
          setCameraPermission(status.state); // 'granted' | 'prompt' | 'denied'
          status.onchange = () => {
            setCameraPermission(status.state);
          };
        } catch (e) {
          // 某些瀏覽器（尤其 iOS Safari）可能不支援 camera query
          setCameraPermission('prompt');
        }
      } else {
        setCameraPermission('prompt');
      }

    } catch (error) {
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

  const handleScanSuccess = async (decodedText) => {
    try {
      if (!decodedText) {
        if (onScanError) onScanError('扫描到的数据为空');
        return;
      }

      const preview = decodedText.length > 50 ? decodedText.substring(0, 50) + '...' : decodedText;
      
      let qrData;
      try {
        qrData = JSON.parse(decodedText);
      } catch (parseError) {
        if (!allowRawText) {
          throw new Error(`扫描到的内容不是系统 QR Code：${preview}`);
        }

        await stopScanning();
        if (onScanSuccess) {
          await Promise.resolve(onScanSuccess(decodedText.trim()));
        }
        return;
      }

      const qrType = qrData?.type || '未知';
      
      try {
        validateQRType(qrType);
      } catch (typeError) {
        throw typeError;
      }
      
      await stopScanning();
      
      if (onScanSuccess) {
        await Promise.resolve(onScanSuccess(qrData));
      }
      
    } catch (error) {
      const errorMessage = error?.message || '扫描处理失败';
      if (onScanError) {
        onScanError(errorMessage);
      }
    }
  };

  const handleScanFailure = (error) => {
    // 忽略逐帧扫描失败
  };

  const startScanning = () => {
    setScanning(true);
  };

  useEffect(() => {
    if (!scanning) {
      return;
    }

    let cancelled = false;

    const init = async () => {
      const el = document.getElementById('qr-reader');
      if (!el) {
        setTimeout(() => {
          if (!cancelled) {
            void init();
          }
        }, 100);
        return;
      }

      // 每次開始前先清乾淨
      if (qrScannerRef.current) {
        await stopScanning({ keepScanningState: true });
      }

      try {
        await initDirectHtml5qrcode();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setScanning(false);
        if (onScanError) onScanError(`扫描器初始化失败: ${error?.message || error}`);
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [scanning]);

  // ✅ 隐藏 html5-qrcode 的所有控制按钮
  const hideHtml5QrcodeButtons = () => {
    try {
      // 隐藏所有按钮
      const buttons = document.querySelectorAll('#qr-reader button');
      buttons.forEach(btn => {
        const text = btn.textContent.toLowerCase();
        // 隐藏 Start Scanning, Stop Scanning, Select Camera 等按钮
        if (text.includes('start') || text.includes('stop') || text.includes('select') || 
            text.includes('camera') || text.includes('torch') || text.includes('switch')) {
          btn.style.display = 'none';
        }
      });
      
      // 隐藏相机选择下拉框
      const selects = document.querySelectorAll('#qr-reader select');
      selects.forEach(select => {
        select.style.display = 'none';
      });
      
      // 隐藏可能的错误提示
      const errorDivs = document.querySelectorAll('#qr-reader div[style*="red"]');
      errorDivs.forEach(div => {
        div.style.display = 'none';
      });
    } catch (error) {
      // 隐藏按钮失败，继续
    }
  };

  // 🔁 直接模式回退：避開 Scanner 包裝的 UI 與某些瀏覽器 Bug
  // ⭐ 改用 MerchantScanner 的優化配置：fps 30 + 自動對焦 + 高分辨率
  const initDirectHtml5qrcode = async () => {
    const el = document.getElementById('qr-reader');
    if (!el) {
      throw new Error('#qr-reader 元素未找到');
    }

    const html5Qr = new Html5Qrcode('qr-reader');
    qrScannerRef.current = html5Qr;

    // ⭐ 優先挑選後置攝像頭；若取不到則用 facingMode
    let cameraConfig = { 
      facingMode: 'environment',
      advanced: [
        { focusMode: 'continuous' }  // 🔍 自動對焦（關鍵！）
      ]
    };
    
    try {
      const cameras = await Html5Qrcode.getCameras();
      const backCam = cameras?.find((c) => /back|rear|environment/i.test(c?.label || ''));
      if (backCam?.id) {
        // 如果找到後置攝像頭，使用設備 ID
        cameraConfig = backCam.id;
      }
    } catch (e) {
      // iOS 在未授權前可能無法列舉相機，直接用 facingMode 走授權流程即可
    }

    // ⭐ 高性能掃碼配置（參考 MerchantScanner）
    const config = {
      fps: 30,  // ⬆️⬆️ 提高到 30 fps，掃碼更快
      aspectRatio: 1.0,
      disableFlip: false,  // ✅ 允許翻轉以應對各種設備方向
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      // ⬆️ 添加高分辨率視頻約束
      videoConstraints: {
        width: { ideal: 1920 },      // 🎥 高分辨率
        height: { ideal: 1080 },
        focusMode: { ideal: 'continuous' },  // 🔍 持續自動對焦
        facingMode: 'environment'
      }
    };

    return html5Qr.start(
      cameraConfig,
      config,
      handleScanSuccess,
      handleScanFailure
    ).then(() => {
      setCameraPermission('granted');
    }).catch((e) => {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraPermission('denied');
      }
      throw e;
    });
  };

  const requestCameraPermission = async () => {
    // ⚠️ 不在這裡先 getUserMedia()，避免「先預檢一次、掃描再請求一次」造成雙重彈窗。
    // 讓 Html5Qrcode.start() 來做唯一一次的權限請求。
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
        <>
          {/* ⬆️ 扫码提示框 */}
          <div style={styles.scannerTips}>
            <p style={styles.scannerTipText}>💡 保持 QR Code 在画面中央，距离 10-20cm</p>
          </div>

          {/* ✅ QR 扫描器容器 */}
          <div id="qr-reader" style={styles.readerContainer}></div>

          {/* 停止扫描按钮 */}
          <button onClick={stopScanning} style={styles.cancelButton}>停止扫描</button>
        </>
      )}

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
        
        /* 只显示视频和扫描框，让视频填满容器 */
        #qr-reader video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
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
    width: '100%',
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
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '0.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  scannerHeader: {
    display: 'none'
  },
  scannerTitle: {
    display: 'none'
  },
  cancelButton: {
    background: '#f44336',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.2s',
    margin: '0 auto',
    display: 'block'
  },
  readerContainer: {
    width: '100%',
    minHeight: '70vh',
    maxHeight: '75vh',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scannerTips: {
    background: 'rgba(33, 150, 243, 0.1)',
    borderLeft: '3px solid #2196F3',
    borderRadius: '4px',
    padding: '0.5rem 0.75rem',
    marginBottom: '0.5rem'
  },
  scannerTipText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#1976D2',
    fontWeight: 500
  }
};

export default QRScanner;
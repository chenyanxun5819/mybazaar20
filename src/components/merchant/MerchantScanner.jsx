/**
 * MerchantScanner - 商家扫码收款组件
 * 
 * 功能：
 * 1. 扫描Customer付款QR Code（记名）
 * 2. 扫描PointCard QR Code（不记名点数卡）
 * 
 * 修改日期：2025-01-20
 */

import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase';
import { CreditCard, User, Scan, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import TransactionPinDialog from '../../views/PointSellerDashboard/common/TransactionPinDialog';
import { formatAmount } from '../../services/transactionService';
import './MerchantScanner.css';

const MerchantScanner = ({ merchant, organizationId, eventId, userRole, currentUserId, autoStart = false }) => {
  // 扫码状态 - 如果 autoStart=true，初始就开始扫描
  const [scanning, setScanning] = useState(autoStart);
  const html5QrCodeRef = useRef(null);

  // QR Code数据
  const [qrData, setQrData] = useState(null);
  const [qrType, setQrType] = useState(null); // 'POINT_CARD' | 'MERCHANT_PAYMENT'

  // 点数卡信息
  const [pointCardInfo, setPointCardInfo] = useState(null);

  // 表单状态
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');

  // 交易密码
  const [showPinDialog, setShowPinDialog] = useState(false);

  // 加载和错误状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // 步骤：scan | show-info | input-amount | processing | success
  const [step, setStep] = useState('scan');

  const stopScanner = async () => {
    const instance = html5QrCodeRef.current;
    if (!instance) return;

    try {
      // stop() 只有在已開始掃描時才有效；若尚未開始會丟錯，這裡容錯
      await instance.stop();
    } catch (err) {
      // ignore
    }

    try {
      instance.clear();
    } catch (err) {
      // ignore
    }

    html5QrCodeRef.current = null;
  };

  const formatCameraError = (err) => {
    const message = String(err?.message || err || 'Unknown error');
    const name = String(err?.name || '');

    const isPermissionDenied =
      name === 'NotAllowedError' ||
      name === 'PermissionDeniedError' ||
      /permission\s*denied|not\s*allowed|denied/i.test(message);

    const isNotFound =
      name === 'NotFoundError' ||
      /not\s*found|no\s*camera|devices\s*not\s*found/i.test(message);

    if (isPermissionDenied) {
      return '相機權限被拒絕。iPhone 請到：設定 → Safari → 相機（允許），或在網址列「aA」→ 網站設定 → 相機 → 允許；然後重新整理再試。';
    }

    if (isNotFound) {
      return '找不到相機裝置。請確認此裝置有相機、且沒有被其他 App 佔用。';
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      return '此瀏覽器不支援相機存取（需要 HTTPS 與支援 getUserMedia）。';
    }

    return '無法啟動相機：' + message;
  };

  // ========================================
  // 初始化 & 啟動掃碼（直接啟動相機，避免卡在 Request Camera Permissions）
  // ========================================
  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        console.log('[MerchantScanner] 初始化相機掃描...');
        setError(null);

        const instance = new Html5Qrcode('merchant-qr-reader');
        html5QrCodeRef.current = instance;

        // 優先挑選後鏡頭；若取不到則用 facingMode
        let cameraConfig = { 
          facingMode: 'environment',
          // ⬆️ 添加高级相机配置
          advanced: [
            { focusMode: 'continuous' }  // 🔍 自动对焦（关键！）
          ]
        };
        
        try {
          const cameras = await Html5Qrcode.getCameras();
          const backCam = cameras?.find((c) => /back|rear|environment/i.test(c?.label || ''));
          if (backCam?.id) {
            // 如果找到后置摄像头，使用设备 ID
            cameraConfig = backCam.id;
          }
        } catch (e) {
          // iOS 在未授權前可能無法列舉相機，直接用 facingMode 走授權流程即可
        }

        await instance.start(
          cameraConfig,
          {
            fps: 30,  // ⬆️⬆️ 大幅提高到 30 fps，扫码更快
            // ❌ 移除 qrbox 限制，让整个画面都能扫码
            aspectRatio: 1.0,
            disableFlip: false,
            // ⬆️ 添加高分辨率视频约束
            videoConstraints: {
              width: { ideal: 1920 },      // 🎥 高分辨率
              height: { ideal: 1080 },
              focusMode: { ideal: 'continuous' },  // 🔍 持续自动对焦
              facingMode: 'environment'
            }
          },
          onScanSuccess,
          onScanError
        );

        if (cancelled) {
          await stopScanner();
          return;
        }

        console.log('[MerchantScanner] 相機已啟動，開始掃描');
      } catch (err) {
        console.error('[MerchantScanner] 相機啟動失敗:', err);
        await stopScanner();
        if (!cancelled) {
          setError(formatCameraError(err));
          setScanning(false);
        }
      }
    };

    if (scanning) {
      start();
    }

    return () => {
      cancelled = true;
      stopScanner().catch(console.error);
    };
  }, [scanning]);

  // ========================================
  // 扫码成功回调
  // ========================================
  const onScanSuccess = async (decodedText) => {
    console.log('[MerchantScanner] 扫描成功:', decodedText);

    try {
      // 停止扫描
      await stopScanner();
      setScanning(false);

      // 解析QR Code
      const parsedData = JSON.parse(decodedText);
      console.log('[MerchantScanner] 解析数据:', parsedData);

      const type = parsedData.type;

      // 识别QR Code类型
      if (type === 'POINT_CARD') {
        // 点数卡付款
        handlePointCardScan(parsedData);
      } else if (type === 'MERCHANT_PAYMENT' || type === 'MERCHANT') {
        // Customer记名付款（暂不支持，可以提示）
        setError('此功能用于扫描点数卡。Customer付款请让顾客扫描您的收款码。');
        setStep('scan');
      } else {
        throw new Error('无效的QR Code类型');
      }

    } catch (err) {
      console.error('[MerchantScanner] 扫描处理错误:', err);
      setError('无法识别的QR Code: ' + err.message);
      setStep('scan');
    }
  };

  const onScanError = (errorMessage) => {
    // 忽略常规扫描错误（未检测到QR Code）
    if (!errorMessage.includes('NotFoundException')) {
      console.warn('[MerchantScanner] 扫描错误:', errorMessage);
    }
  };

  // ========================================
  // 处理点数卡扫描
  // ========================================
  const handlePointCardScan = async (parsedData) => {
    console.log('[MerchantScanner] 处理点数卡扫描:', parsedData);

    setLoading(true);
    setError(null);
    setQrData(parsedData);
    setQrType('POINT_CARD');

    try {
      // 调用 queryPointCardBalance 查询余额
      const queryBalance = httpsCallable(functions, 'queryPointCardBalance');
      const result = await queryBalance({
        cardId: parsedData.cardId,
        organizationId: parsedData.organizationId || organizationId,
        eventId: parsedData.eventId || eventId
      });

      console.log('[MerchantScanner] 查询余额结果:', result.data);

      if (result.data.success) {
        setPointCardInfo(result.data);
        setStep('show-info');
      } else {
        throw new Error(result.data.message || '查询点数卡失败');
      }

    } catch (err) {
      console.error('[MerchantScanner] 查询余额错误:', err);
      
      // ⭐ 改进：提取Firebase Error的详细信息
      let errorMessage = '查询点数卡失败';
      
      if (err.code) {
        const errorMessages = {
          'functions/not-found': '找不到该点数卡，请确认QR Code是否正确',
          'functions/permission-denied': '没有权限查询此点数卡',
          'functions/invalid-argument': '点数卡参数错误',
          'functions/unauthenticated': '用户未认证',
          'functions/internal': '系统内部错误'
        };
        
        errorMessage = errorMessages[err.code] || err.message || err.code;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      setStep('scan');
    } finally {
      setLoading(false);
    }
  };

  // ========================================
  // 处理金额输入
  // ========================================
  const handleAmountSubmit = () => {
    setAmountError('');

    // 验证金额
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setAmountError('请输入有效的金额');
      return;
    }

    if (numAmount > pointCardInfo.balance.current) {
      setAmountError(`余额不足（可用：${pointCardInfo.balance.current} 点）`);
      return;
    }

    // 显示交易密码对话框
    setShowPinDialog(true);
  };

  // ========================================
  // 确认扣款（输入交易密码后）
  // ========================================
  const handlePinConfirm = async (transactionPin) => {
    setLoading(true);
    setError(null);

    try {
      console.log('[MerchantScanner] 开始处理点数卡付款...');

      const processPayment = httpsCallable(functions, 'processPointCardPayment');
      const result = await processPayment({
        cardId: qrData.cardId,
        merchantId: merchant.id,
        amount: parseFloat(amount),
        transactionPin: transactionPin,
        organizationId: organizationId,
        eventId: eventId
      });

      console.log('[MerchantScanner] 付款结果:', result.data);

      if (result.data.success) {
        setSuccess({
          message: '收款成功！',
          transactionId: result.data.transactionId,
          amount: parseFloat(amount),
          remainingBalance: result.data.remainingBalance
        });
        setShowPinDialog(false);
        setStep('success');
      } else {
        throw new Error(result.data.message || '付款失败');
      }

    } catch (err) {
      console.error('[MerchantScanner] 付款错误:', err);
      
      // ⭐ 改进：提取Firebase Error的详细信息
      let errorMessage = '付款失败';
      
      if (err.code) {
        // Firebase Functions Error
        const errorMessages = {
          'functions/failed-precondition': err.message || '前置条件检查失败',
          'functions/permission-denied': '权限不足或密码错误',
          'functions/not-found': '找不到相关数据',
          'functions/invalid-argument': '参数错误',
          'functions/unauthenticated': '用户未认证',
          'functions/internal': '系统内部错误'
        };
        
        errorMessage = errorMessages[err.code] || err.message || err.code;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      setShowPinDialog(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePinCancel = () => {
    setShowPinDialog(false);
  };

  // ========================================
  // 重置状态
  // ========================================
  const handleReset = () => {
    setQrData(null);
    setQrType(null);
    setPointCardInfo(null);
    setAmount('');
    setAmountError('');
    setError(null);
    setSuccess(null);
    setStep('scan');
  };

  const handleScanAgain = () => {
    handleReset();
    setScanning(true);
  };

  // ========================================
  // UI 渲染
  // ========================================

  // 步骤1：扫码界面
  if (step === 'scan') {
    return (
      <div className="merchant-scanner">
          {error && (
          <div className="scanner-error">
            <AlertCircle />
            <p>{error}</p>
            <button onClick={handleReset} className="error-dismiss">
              知道了
            </button>
          </div>
        )}

        {!scanning ? (
          <div className="scanner-start">
            <button
              onClick={() => setScanning(true)}
              className="start-scan-btn"
            >
              <Scan />
              开始扫描
            </button>

            <div className="scanner-instructions">
              <h3>📱 使用说明</h3>
              <ul>
                <li>点击「开始扫描」按钮</li>
                <li>对准顾客的点数卡 QR Code</li>
                <li>系统自动识别并查询余额</li>
                <li>输入收款金额并确认</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="scanner-camera">
            {/* ⬆️ 添加扫码提示 */}
            <div className="scanner-tips">
              <p>💡 保持 QR Code 在画面中央，距离 10-20cm</p>
            </div>
            <div id="merchant-qr-reader"></div>
            <button
              onClick={() => {
                console.log('[MerchantScanner] 用户停止扫描');
                stopScanner().catch(console.error);
                setScanning(false);
              }}
              className="stop-scan-btn"
            >
              停止扫描
            </button>
          </div>
        )}
      </div>
    );
  }

  // 步骤2：显示点数卡信息
  if (step === 'show-info' && pointCardInfo) {
    return (
      <div className="merchant-scanner">
        <div className="card-info-container">
          <div className="card-info-header">
            <CreditCard className="card-icon" />
            <h2>点数卡信息</h2>
          </div>

          <div className="card-details">
            <div className="card-detail-row">
              <span className="detail-label">卡号：</span>
              <span className="detail-value">{pointCardInfo.cardNumber}</span>
            </div>
            <div className="card-detail-row">
              <span className="detail-label">当前余额：</span>
              <span className="detail-value balance">
                {formatAmount(pointCardInfo.balance.current)} 点
              </span>
            </div>
            <div className="card-detail-row">
              <span className="detail-label">初始点数：</span>
              <span className="detail-value">
                {formatAmount(pointCardInfo.balance.initial)} 点
              </span>
            </div>
            <div className="card-detail-row">
              <span className="detail-label">已消费：</span>
              <span className="detail-value">
                {formatAmount(pointCardInfo.balance.spent)} 点
              </span>
            </div>

            {/* 状态检查 */}
            {!pointCardInfo.status.isActive && (
              <div className="card-status-error">
                <AlertCircle />
                <p>此卡片已失效</p>
              </div>
            )}
            {pointCardInfo.status.isExpired && (
              <div className="card-status-error">
                <AlertCircle />
                <p>此卡片已过期</p>
              </div>
            )}
          </div>

          {/* 输入金额 */}
          <div className="amount-input-section">
            <label htmlFor="paymentAmount">收款金额</label>
            <div className="amount-input-wrapper">
              <input
                id="paymentAmount"
                type="number"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError('');
                }}
                placeholder="请输入金额"
                min="1"
                max={pointCardInfo.balance.current}
                disabled={loading}
              />
              <span className="input-suffix">点</span>
            </div>
            {amountError && (
              <p className="amount-error">{amountError}</p>
            )}
            <p className="amount-hint">
              可用余额：{formatAmount(pointCardInfo.balance.current)} 点
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="card-actions">
            <button
              onClick={handleReset}
              className="cancel-btn"
              disabled={loading}
            >
              取消
            </button>
            <button
              onClick={handleAmountSubmit}
              className="confirm-btn"
              disabled={loading || !amount || !pointCardInfo.status.isActive}
            >
              确认收款
            </button>
          </div>
        </div>

        {/* 交易密码对话框 */}
        {showPinDialog && (
          <TransactionPinDialog
            title="确认收款"
            message={`即将从点数卡扣除 ${formatAmount(amount)} 点`}
            onConfirm={handlePinConfirm}
            onCancel={handlePinCancel}
            confirmButtonText="✅ 确认收款"
          />
        )}
      </div>
    );
  }

  // 步骤3：交易成功
  if (step === 'success' && success) {
    return (
      <div className="merchant-scanner">
        <div className="success-container">
          <div className="success-icon">
            <CheckCircle />
          </div>
          <h2>收款成功！</h2>

          <div className="success-details">
            <div className="success-row">
              <span className="success-label">收款金额：</span>
              <span className="success-value">
                {formatAmount(success.amount)} 点
              </span>
            </div>
            <div className="success-row">
              <span className="success-label">卡片余额：</span>
              <span className="success-value">
                {formatAmount(success.remainingBalance)} 点
              </span>
            </div>
            <div className="success-row">
              <span className="success-label">交易编号：</span>
              <span className="success-value transaction-id">
                {success.transactionId?.substring(0, 12)}...
              </span>
            </div>
          </div>

          <div className="success-actions">
            <button
              onClick={handleScanAgain}
              className="scan-again-btn"
            >
              继续扫码
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 默认加载状态
  return (
    <div className="merchant-scanner">
      <div className="scanner-loading">
        <div className="loading-spinner"></div>
        <p>处理中...</p>
      </div>
    </div>
  );
};

export default MerchantScanner;
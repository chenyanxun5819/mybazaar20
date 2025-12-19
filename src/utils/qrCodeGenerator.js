/**
 * 生成商家付款 QR Code 的資料字串
 * @param {string} organizationId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @returns {string} QR Code 資料字串
 */
export const generateMerchantPaymentQR = (organizationId, eventId, merchantId) => {
  const qrData = {
    type: 'MERCHANT_PAYMENT',
    v: '1.0', // version
    orgId: organizationId,
    eventId: eventId,
    merchantId: merchantId,
    ts: Date.now() // timestamp
  };

  // 轉換為 JSON 字串
  return JSON.stringify(qrData);
};

/**
 * 解析 QR Code 資料
 * @param {string} qrDataString - QR Code 掃描得到的字串
 * @returns {Object} 解析後的資料
 */
export const parseQRData = (qrDataString) => {
  try {
    const data = JSON.parse(qrDataString);

    // 驗證資料格式
    if (data.type !== 'MERCHANT_PAYMENT') {
      throw new Error('無效的 QR Code 類型');
    }

    if (!data.orgId || !data.eventId || !data.merchantId) {
      throw new Error('QR Code 資料不完整');
    }

    return {
      organizationId: data.orgId,
      eventId: data.eventId,
      merchantId: data.merchantId,
      timestamp: data.ts,
      version: data.v
    };
  } catch (error) {
    console.error('Error parsing QR data:', error);
    throw new Error('無法解析 QR Code');
  }
};

/**
 * 驗證 QR Code 是否有效
 * @param {Object} qrData - 解析後的 QR 資料
 * @param {number} maxAgeMinutes - QR Code 最大有效時間（分鐘）
 * @returns {Object} 驗證結果
 */
export const validateQRData = (qrData, maxAgeMinutes = 60) => {
  if (!qrData) {
    return {
      isValid: false,
      error: 'QR Code 資料為空'
    };
  }

  // 檢查必要欄位
  if (!qrData.organizationId || !qrData.eventId || !qrData.merchantId) {
    return {
      isValid: false,
      error: 'QR Code 資料不完整'
    };
  }

  // 檢查時效性（可選）
  if (qrData.timestamp && maxAgeMinutes > 0) {
    const now = Date.now();
    const age = now - qrData.timestamp;
    const maxAge = maxAgeMinutes * 60 * 1000;

    if (age > maxAge) {
      return {
        isValid: false,
        error: 'QR Code 已過期'
      };
    }
  }

  return {
    isValid: true,
    error: null
  };
};

/**
 * 生成用於分享的 URL（包含 QR 資料）
 * @param {string} organizationId - 組織 ID
 * @param {string} eventId - 活動 ID
 * @param {string} merchantId - 商家 ID
 * @returns {string} 分享 URL
 */
export const generatePaymentURL = (organizationId, eventId, merchantId) => {
  const baseUrl = window.location.origin;
  const params = new URLSearchParams({
    org: organizationId,
    event: eventId,
    merchant: merchantId
  });

  return `${baseUrl}/customer/pay?${params.toString()}`;
};

/**
 * 從 URL 參數解析付款資訊
 * @param {string} urlString - URL 字串
 * @returns {Object} 付款資訊
 */
export const parsePaymentURL = (urlString) => {
  try {
    const url = new URL(urlString);
    const params = new URLSearchParams(url.search);

    const organizationId = params.get('org');
    const eventId = params.get('event');
    const merchantId = params.get('merchant');

    if (!organizationId || !eventId || !merchantId) {
      throw new Error('URL 參數不完整');
    }

    return {
      organizationId,
      eventId,
      merchantId
    };
  } catch (error) {
    console.error('Error parsing payment URL:', error);
    throw new Error('無效的付款 URL');
  }
};

/**
 * 下載 QR Code 為圖片
 * @param {HTMLCanvasElement} canvas - QR Code Canvas 元素
 * @param {string} filename - 檔案名稱
 */
export const downloadQRCode = (canvas, filename = 'merchant-qr-code.png') => {
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  try {
    // 將 canvas 轉換為 blob
    canvas.toBlob((blob) => {
      if (!blob) {
        console.error('Failed to create blob');
        return;
      }

      // 創建下載連結
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      
      // 觸發下載
      document.body.appendChild(link);
      link.click();
      
      // 清理
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  } catch (error) {
    console.error('Error downloading QR code:', error);
    throw new Error('下載 QR Code 失敗');
  }
};

/**
 * 分享 QR Code（使用 Web Share API）
 * @param {HTMLCanvasElement} canvas - QR Code Canvas 元素
 * @param {string} stallName - 攤位名稱
 * @returns {Promise<void>}
 */
export const shareQRCode = async (canvas, stallName) => {
  if (!canvas) {
    throw new Error('Canvas element not found');
  }

  // 檢查瀏覽器是否支援 Web Share API
  if (!navigator.share) {
    throw new Error('您的瀏覽器不支援分享功能');
  }

  try {
    // 將 canvas 轉換為 blob
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      });
    });

    // 創建 File 對象
    const file = new File([blob], 'qr-code.png', { type: 'image/png' });

    // 分享
    await navigator.share({
      title: `${stallName} - 付款 QR Code`,
      text: `掃描此 QR Code 向 ${stallName} 付款`,
      files: [file]
    });
  } catch (error) {
    console.error('Error sharing QR code:', error);
    throw error;
  }
};

/**
 * 格式化 QR Code 顯示文字
 * @param {Object} qrData - QR 資料
 * @returns {string} 格式化文字
 */
export const formatQRDisplayText = (qrData) => {
  if (!qrData) return '';

  const lines = [
    '請顧客掃描此 QR Code 付款',
    '',
    `商家 ID: ${qrData.merchantId.substring(0, 8)}...`,
    `活動 ID: ${qrData.eventId.substring(0, 8)}...`
  ];

  return lines.join('\n');
};
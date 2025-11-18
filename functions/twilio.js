const functions = require('firebase-functions');
const crypto = require('crypto');
const admin = require('firebase-admin');
const https = require('https');
require('dotenv').config();

// 360 配置
const SMS_PROVIDER = process.env.SMS_PROVIDER || '360'; // 'infobip' 或 '360'
const API_KEY_360 = process.env.API_KEY_360 || 'GELe3DQa69';
const API_SECRET_360 = process.env.API_SECRET_360 || 'P5k4ukqYOmE2ULjjCZGQc5Mvzh7OFZLw7sY8zjUc';
const API_BASE_URL_360 = process.env.API_BASE_URL_360 || 'https://sms.360.my/gw/bulk360/v3_0/send.php';

// Infobip 配置（備用）
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY || '6af983e84d2cd133e4afef095c5dd90e-b6ad3de7-5278-416d-916c-8bcb684a234a';
const INFOBIP_API_BASE_URL = process.env.INFOBIP_API_BASE_URL || '51w5lj.api.infobip.com';
const INFOBIP_SENDER_NUMBER = process.env.INFOBIP_SENDER_NUMBER || 'MyBazaar'; // 使用字母發送者 ID

console.log('[SMS Provider]', {
  provider: SMS_PROVIDER,
  ...(SMS_PROVIDER === '360' ? {
    apiKey360: API_KEY_360.substring(0, 5) + '***',
    apiBaseUrl360: API_BASE_URL_360
  } : {
    infobipApiKey: INFOBIP_API_KEY.substring(0, 10) + '***',
    infobipBaseUrl: INFOBIP_API_BASE_URL,
    infobipSenderNumber: INFOBIP_SENDER_NUMBER
  })
});

/**
 * 使用 360 API 發送 SMS
 */
function sendSmsVia360(phoneNumber, message) {
  return new Promise((resolve, reject) => {
    try {
      // 360 API 參數
      // 注意：from 只能是 11 個英數字，不能有空格或特殊符號
      const queryParams = new URLSearchParams({
        user: API_KEY_360,
        pass: API_SECRET_360,
        to: phoneNumber,
        from: 'MyBazaar', // 11 個英數字
        text: message
        // 移除 detail，避免可能的參數問題
      });

      const bodyStr = queryParams.toString();
      console.log('[sendSmsVia360] 準備發送到 360 API');
      console.log('[sendSmsVia360] 請求 URL: https://sms.360.my/gw/bulk360/v3_0/send.php');
      console.log('[sendSmsVia360] 請求 Body:', bodyStr);
      console.log('[sendSmsVia360] 電話號碼:', phoneNumber);
      console.log('[sendSmsVia360] 訊息:', message);

      const options = {
        hostname: 'sms.360.my',
        port: 443,
        path: '/gw/bulk360/v3_0/send.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`[sendSmsVia360] 360 API 響應狀態碼: ${res.statusCode}`);
          console.log(`[sendSmsVia360] 360 API 響應內容: ${data}`);
          
          try {
            const result = JSON.parse(data);
            console.log('[sendSmsVia360] 360 API 解析結果:', result);
            
            if (result.code === 200 || result.code === '200') {
              console.log('[sendSmsVia360] ✅ SMS 已成功發送到 360，Reference ID:', result.ref);
              resolve(result);
            } else {
              reject(new Error(`360 API 錯誤 (code=${result.code}): ${result.desc || data}`));
            }
          } catch (e) {
            console.error('[sendSmsVia360] ❌ 解析 360 API 響應失敗:', data);
            console.error('[sendSmsVia360] 解析錯誤詳情:', e.message);
            reject(new Error(`解析 360 API 響應失敗: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('[sendSmsVia360] ❌ HTTPS 請求錯誤:', error.message);
        reject(error);
      });

      req.write(bodyStr);
      req.end();
    } catch (error) {
      console.error('[sendSmsVia360] ❌ 異常:', error);
      reject(error);
    }
  });
}

/**
 * 使用 HTTPS 發送 SMS（基於 Infobip API）
 */
function sendSmsViaHttps(phoneNumber, message) {
  return new Promise((resolve, reject) => {
    try {
      const requestBody = JSON.stringify({
        messages: [
          {
            destinations: [{ to: phoneNumber.replace(/\s+/g, '') }],
            from: INFOBIP_SENDER_NUMBER.replace(/\s+/g, ''),
            text: message
          }
        ]
      });

      const options = {
        hostname: INFOBIP_API_BASE_URL,
        port: 443,
        path: '/sms/2/text/advanced',
        method: 'POST',
        headers: {
          'Authorization': `App ${INFOBIP_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              const result = JSON.parse(data);
              console.log('[sendSmsViaHttps] SMS 已發送，Response:', result);
              resolve(result);
            } catch (e) {
              reject(new Error(`解析 Infobip 響應失敗: ${data}`));
            }
          } else {
            reject(new Error(`Infobip 錯誤 (${res.statusCode}): ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('[sendSmsViaHttps] 請求錯誤:', error);
        reject(error);
      });

      req.write(requestBody);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 生成 OTP 碼
 */
function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * SHA256 雜湊函式
 */
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * HTTP 函式：發送 OTP
 * POST /api/sendOtp
 * Body: { phoneNumber, orgCode, eventCode }
 */
exports.sendOtpHttp = functions.https.onRequest(async (req, res) => {
  // CORS 設定
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  try {
    const { phoneNumber, orgCode, eventCode } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少手机号码' } });
    }

    console.log('[sendOtpHttp] 發送 OTP 要求:', { phoneNumber, orgCode, eventCode });

    // 生成 OTP 碼
    const otpCode = generateOtpCode();
    const otpCodeHash = sha256(otpCode);
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 分鐘有效期

    // 保存 OTP 到 Firestore
    const db = admin.firestore();
    await db.collection('otp_sessions').doc(sessionId).set({
      sessionId,
      phoneNumber,
      orgCode: orgCode || '',
      eventCode: eventCode || '',
      otpCodeHash,
      expiresAt,
      attempts: 0,
      createdAt: new Date()
    });

    console.log(`[sendOtpHttp] OTP 記錄已保存到 Firestore: ${sessionId}`);

    // 發送 SMS
    // 正確格式化馬來西亞電話號碼：將 0 開頭轉為 +60
    let formattedPhone = phoneNumber.trim();
    
    // 移除所有空格和特殊字符
    formattedPhone = formattedPhone.replace(/[\s\-\(\)]/g, '');
    
    // 如果是 0 開頭，轉為 +60
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '+60' + formattedPhone.substring(1);
    }
    // 如果是 60 開頭但沒有 +，加上 +
    else if (formattedPhone.startsWith('60') && !formattedPhone.startsWith('+')) {
      formattedPhone = '+' + formattedPhone;
    }
    // 如果已經是 +60 或其他格式，保持不變
    
    const message = `Your verification code is: ${otpCode}. Valid for 5 minutes.`;

    console.log(`[sendOtpHttp] 準備發送 SMS 到: ${formattedPhone} (原始: ${phoneNumber}), 訊息: ${message}`);

    // 開發環境：直接在日誌中顯示 OTP 以便測試
    const isDevelopment = process.env.NODE_ENV !== 'production';
    if (isDevelopment) {
      console.log(`[DEV MODE] ⚠️ OTP Code: ${otpCode} ⚠️`);
      console.log(`[DEV MODE] SessionID: ${sessionId}`);
    }

    try {
      let smsResult;
      if (SMS_PROVIDER === '360') {
        console.log(`[sendOtpHttp] 使用 360 SMS Provider 發送到: ${formattedPhone}`);
        smsResult = await sendSmsVia360(formattedPhone, message);
        console.log(`[sendOtpHttp] 360 SMS 已發送，Result:`, smsResult);
      } else {
        console.log(`[sendOtpHttp] 使用 Infobip SMS Provider 發送到: ${formattedPhone}`);
        smsResult = await sendSmsViaHttps(formattedPhone, message);
        console.log(`[sendOtpHttp] Infobip SMS 已發送，MessageID:`, smsResult?.messages?.[0]?.messageId);
      }
    } catch (smsError) {
      console.error('[sendOtpHttp] SMS 發送失敗，錯誤詳情:', smsError.message);
      console.error('[sendOtpHttp] 錯誤堆棧:', smsError.stack);
      console.error('[sendOtpHttp] 但 OTP 已保存到 Firestore，可繼續驗證');
      
      // 開發環境：即使 SMS 失敗也在日誌中顯示 OTP
      if (isDevelopment) {
        console.log(`[DEV MODE] ⚠️ 由於 SMS 失敗，請使用此 OTP: ${otpCode} ⚠️`);
      }
    }

    return res.status(200).json({
      success: true,
      sessionId,
      message: '驗證碼已發送，請檢查手機短信',
      expiresIn: 300 // 秒
    });
  } catch (error) {
    console.error('[sendOtpHttp] 錯誤:', error);
    return res.status(500).json({
      error: {
        code: 'internal',
        message: error.message || '發送驗證碼失敗'
      }
    });
  }
});

/**
 * HTTP 函式：驗證 OTP
 * POST /api/verifyOtp
 * Body: { phoneNumber, otp, orgCode, eventCode }
 */
exports.verifyOtpHttp = functions.https.onRequest(async (req, res) => {
  // CORS 設定
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  try {
    const { phoneNumber, otp, orgCode, eventCode } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少手機號碼或驗證碼' } });
    }

    if (otp.length !== 6 || !/^\d+$/.test(otp)) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '驗證碼格式不正確' } });
    }

    console.log('[verifyOtpHttp] 驗證 OTP:', { phoneNumber, orgCode, eventCode });

    const db = admin.firestore();

    // 查詢最新的 OTP session
    const otpSnapshot = await db.collection('otp_sessions')
      .where('phoneNumber', '==', phoneNumber)
      .where('orgCode', '==', orgCode || '')
      .where('eventCode', '==', eventCode || '')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (otpSnapshot.empty) {
      console.log('[verifyOtpHttp] 找不到 OTP session');
      return res.status(404).json({ error: { code: 'not-found', message: '驗證碼不存在或已過期' } });
    }

    const otpDoc = otpSnapshot.docs[0];
    const otpData = otpDoc.data();

    // 檢查是否過期
    if (Date.now() > otpData.expiresAt) {
      console.log('[verifyOtpHttp] OTP 已過期');
      return res.status(400).json({ error: { code: 'deadline-exceeded', message: '驗證碼已過期，請重新申請' } });
    }

    // 檢查嘗試次數
    if ((otpData.attempts || 0) >= 5) {
      console.log('[verifyOtpHttp] OTP 嘗試次數過多');
      return res.status(429).json({ error: { code: 'resource-exhausted', message: '嘗試次數過多，請重新申請驗證碼' } });
    }

    // 驗證 OTP
    const inputOtpHash = sha256(otp);
    if (inputOtpHash !== otpData.otpCodeHash) {
      // 增加嘗試次數
      await otpDoc.ref.update({ attempts: (otpData.attempts || 0) + 1 });
      console.log('[verifyOtpHttp] OTP 驗證失敗，嘗試次數：', (otpData.attempts || 0) + 1);
      return res.status(403).json({ error: { code: 'permission-denied', message: '驗證碼錯誤' } });
    }

    console.log('[verifyOtpHttp] OTP 驗證成功');

    // 刪除已使用的 OTP
    await otpDoc.ref.delete();

    return res.status(200).json({
      success: true,
      message: '驗證成功',
      phoneNumber,
      verified: true
    });
  } catch (error) {
    console.error('[verifyOtpHttp] 錯誤:', error);
    return res.status(500).json({
      error: {
        code: 'internal',
        message: error.message || '驗證失敗'
      }
    });
  }
});

/**
 * Callable 函式：生成測試 OTP（開發用）
 */
exports.generateTestOtp = functions.https.onCall(async (data, context) => {
  // 只允許開發環境
  if (!process.env.FUNCTIONS_EMULATOR && process.env.NODE_ENV === 'production') {
    throw new functions.https.HttpsError('permission-denied', '此函式僅可在開發環境使用');
  }

  const { phoneNumber } = data;
  if (!phoneNumber) {
    throw new functions.https.HttpsError('invalid-argument', '缺少手機號碼');
  }

  const otpCode = generateOtpCode();
  const otpCodeHash = sha256(otpCode);
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  const db = admin.firestore();
  await db.collection('otp_sessions').doc(sessionId).set({
    sessionId,
    phoneNumber,
    otpCodeHash,
    expiresAt,
    attempts: 0,
    createdAt: new Date()
  });

  console.log(`[generateTestOtp] 測試 OTP 已生成: ${otpCode}`);

  return {
    sessionId,
    otpCode,
    message: '測試 OTP 已生成（僅開發用）'
  };
});

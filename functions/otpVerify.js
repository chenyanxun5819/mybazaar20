const functions = require('firebase-functions');
const crypto = require('crypto');
const admin = require('firebase-admin');
const https = require('https');
require('dotenv').config();

// ===========================================
// 🔧 開發模式配置
// ===========================================
// 設置為 true：使用固定 OTP 223344（節省測試費用）
// 設置為 false：使用真實 SMS OTP（生產環境）
const USE_DEV_OTP = process.env.USE_DEV_OTP === 'true' || true; // 默認開啟開發模式
const DEV_OTP_CODE = '223344'; // 固定的開發 OTP

console.log('[SMS Config] USE_DEV_OTP:', USE_DEV_OTP);
if (USE_DEV_OTP) {
  console.log('[SMS Config] 🔧 開發模式：使用固定 OTP', DEV_OTP_CODE);
}

// 360 配置
const SMS_PROVIDER = process.env.SMS_PROVIDER || '360'; // 'infobip' 或 '360'
const API_KEY_360 = process.env.API_KEY_360 || 'GELe3DQa69';
const API_SECRET_360 = process.env.API_SECRET_360 || 'P5k4ukqYOmE2ULjjCZGQc5Mvzh7OFZLw7sY8zjUc';
const API_BASE_URL_360 = process.env.API_BASE_URL_360 || 'https://sms.360.my/developers/v3.0';

// Infobip 配置（備用）
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY || '6af983e84d2cd133e4afef095c5dd90e-b6ad3de7-5278-416d-916c-8bcb684a234a';
const INFOBIP_API_BASE_URL = process.env.INFOBIP_API_BASE_URL || '51w5lj.api.infobip.com';
const INFOBIP_SENDER_NUMBER = process.env.INFOBIP_SENDER_NUMBER || 'MyBazaar'; // 使用字母發送者 ID

console.log('[SMS Config] SMS_PROVIDER:', SMS_PROVIDER);

/**
 * 使用 360 API 發送 SMS
 */
function sendSmsVia360(phoneNumber, message) {
  return new Promise((resolve, reject) => {
    try {
      // 將號碼轉為 360 需要的 MSISDN（國碼在前，且不含 +）
      let msisdn = String(phoneNumber || '').replace(/[^\d+]/g, '');
      if (msisdn.startsWith('+')) msisdn = msisdn.slice(1);
      if (msisdn.startsWith('0')) {
        // 本地 0 開頭，轉為 60 + 去頭
        msisdn = '60' + msisdn.slice(1);
      } else if (!msisdn.startsWith('60')) {
        // 仍非 60 開頭，若疑似本地 1 開頭，補 60
        if (msisdn.startsWith('1')) {
          msisdn = '60' + msisdn;
        }
      }

      const queryParams = new URLSearchParams({
        user: API_KEY_360,
        pass: API_SECRET_360,
        to: msisdn,
        // 'from' 在馬來西亞不適用，為避免 400 直接省略
        text: message
      });

      const bodyStr = queryParams.toString();

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
          try {
            const result = JSON.parse(data);
            if (result.code === 200 || result.code === '200') {
              resolve(result);
            } else {
              reject(new Error(`360 API error (code=${result.code}): ${result.desc || data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse 360 API response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(bodyStr);
      req.end();
    } catch (error) {
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
              resolve(result);
            } catch (e) {
              reject(new Error(`Failed to parse Infobip response: ${data}`));
            }
          } else {
            reject(new Error(`Infobip error (${res.statusCode}): ${data}`));
          }
        });
      });

      req.on('error', (error) => {
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
  // 🔧 開發模式：返回固定 OTP
  if (USE_DEV_OTP) {
    console.log('[generateOtpCode] 🔧 開發模式：返回固定 OTP');
    return DEV_OTP_CODE;
  }
  
  // 生產模式：生成隨機 OTP
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

    // 生成 OTP 碼（開發模式會返回固定值）
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
      createdAt: new Date(),
      devMode: USE_DEV_OTP // 標記是否為開發模式
    });

    // 🔧 開發模式：跳過真實 SMS 發送
    if (USE_DEV_OTP) {
      console.log('[sendOtpHttp] 🔧 開發模式：跳過真實 SMS 發送');
      console.log('[sendOtpHttp] 🔧 請使用固定 OTP:', DEV_OTP_CODE);
      
      return res.status(200).json({
        success: true,
        sessionId,
        message: `🔧 開發模式：請輸入固定驗證碼 ${DEV_OTP_CODE}`,
        expiresIn: 300, // 秒
        devMode: true,
        devOtp: DEV_OTP_CODE // 開發模式下直接返回 OTP（僅用於測試）
      });
    }

    // 生產模式：發送 SMS
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

    try {
      if (SMS_PROVIDER === '360') {
        await sendSmsVia360(formattedPhone, message);
      } else {
        await sendSmsViaHttps(formattedPhone, message);
      }
    } catch (smsError) {
      console.error('[sendOtpHttp] SMS send failed:', smsError.message);
      // OTP 已存入 Firestore，驗證仍可繼續進行
    }

    return res.status(200).json({
      success: true,
      sessionId,
      message: '驗證碼已發送，請檢查手機短信',
      expiresIn: 300, // 秒
      devMode: false
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
      return res.status(404).json({ error: { code: 'not-found', message: '驗證碼不存在或已過期' } });
    }

    const otpDoc = otpSnapshot.docs[0];
    const otpData = otpDoc.data();

    // 檢查是否過期
    if (Date.now() > otpData.expiresAt) {
      return res.status(400).json({ error: { code: 'deadline-exceeded', message: '驗證碼已過期，請重新申請' } });
    }

    // 檢查嘗試次數
    if ((otpData.attempts || 0) >= 5) {
      return res.status(429).json({ error: { code: 'resource-exhausted', message: '嘗試次數過多，請重新申請驗證碼' } });
    }

    // 驗證 OTP
    const inputOtpHash = sha256(otp);
    if (inputOtpHash !== otpData.otpCodeHash) {
      // 增加嘗試次數
      await otpDoc.ref.update({ attempts: (otpData.attempts || 0) + 1 });
      return res.status(403).json({ error: { code: 'permission-denied', message: '驗證碼錯誤' } });
    }

    // ✅ 驗證用戶是否為該活動的 Event Manager
    // 1. 查找組織
    const orgQuery = await db.collection('organizations').where('orgCode', '==', orgCode).limit(1).get();
    if (orgQuery.empty) {
      return res.status(404).json({ error: { code: 'not-found', message: '组织不存在' } });
    }
    const orgDoc = orgQuery.docs[0];
    
    // 2. 查找活動
    const eventQuery = await orgDoc.ref.collection('events').where('eventCode', '==', eventCode).limit(1).get();
    if (eventQuery.empty) {
      return res.status(404).json({ error: { code: 'not-found', message: '活动不存在' } });
    }
    const eventDoc = eventQuery.docs[0];
    const eventData = eventDoc.data();

    // 3. 檢查手機號是否在 admins 列表中
    const admins = Array.isArray(eventData.admins) ? eventData.admins : [];
    
    const normalizePhone = (p) => {
      if (!p) return '';
      let digits = String(p).replace(/[^0-9]/g, '');
      // 統一移除 60 開頭 (如果長度足夠) 或 0 開頭，保留核心號碼
      if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2); 
      if (digits.startsWith('0')) digits = digits.substring(1);
      return digits; 
    };

    const targetPhone = normalizePhone(phoneNumber);
    const isEventManager = admins.some(adm => {
      const admPhone = adm.phone || adm.phoneNumber;
      return admPhone && normalizePhone(admPhone) === targetPhone;
    });

    if (!isEventManager) {
      return res.status(403).json({ error: { code: 'permission-denied', message: '您不是此活动的管理员' } });
    }

    // ✅ OTP 驗證成功且權限確認，創建 Custom Token
    const uid = `eventManager_${phoneNumber}`;
    
    const customToken = await admin.auth().createCustomToken(uid, {
      role: 'eventManager',
      orgCode: orgCode,
      eventCode: eventCode,
      phone: phoneNumber
    });

    // 刪除已使用的 OTP
    await otpDoc.ref.delete();

    return res.status(200).json({
      success: true,
      message: '驗證成功',
      phoneNumber,
      verified: true,
      customToken: customToken,
      devMode: otpData.devMode || false
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

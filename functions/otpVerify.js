const functions = require('firebase-functions');
const crypto = require('crypto');
const admin = require('firebase-admin');
const https = require('https');
require('dotenv').config();

// ===========================================
// 🔧 开发模式配置
// ===========================================
const USE_DEV_OTP = process.env.USE_DEV_OTP === 'true' || true;
const DEV_OTP_CODE = '223344';

console.log('[SMS Config] USE_DEV_OTP:', USE_DEV_OTP);
if (USE_DEV_OTP) {
  console.log('[SMS Config] 🔧 开发模式：使用固定 OTP', DEV_OTP_CODE);
}

// 360 配置
const SMS_PROVIDER = process.env.SMS_PROVIDER || '360';
const API_KEY_360 = process.env.API_KEY_360 || 'GELe3DQa69';
const API_SECRET_360 = process.env.API_SECRET_360 || 'P5k4ukqYOmE2ULjjCZGQc5Mvzh7OFZLw7sY8zjUc';

// Infobip 配置（备用）
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY || '6af983e84d2cd133e4afef095c5dd90e-b6ad3de7-5278-416d-916c-8bcb684a234a';
const INFOBIP_API_BASE_URL = process.env.INFOBIP_API_BASE_URL || '51w5lj.api.infobip.com';
const INFOBIP_SENDER_NUMBER = process.env.INFOBIP_SENDER_NUMBER || 'MyBazaar';

console.log('[SMS Config] SMS_PROVIDER:', SMS_PROVIDER);

// ===========================================
// 🔧 读取 Platform Settings
// ===========================================
async function getPlatformSettings() {
  try {
    const db = admin.firestore();
    const settingsDoc = await db.collection('platform_settings').doc('config').get();

    if (!settingsDoc.exists) {
      console.warn('[getPlatformSettings] ⚠️ platform_settings/config 不存在，使用默认配置');
      return null;
    }

    return settingsDoc.data();
  } catch (error) {
    console.error('[getPlatformSettings] 读取配置失败:', error);
    return null;
  }
}

// ===========================================
// 📱 SMS 发送函数
// ===========================================

/**
 * 使用 360 API 发送 SMS
 */
function sendSmsVia360(phoneNumber, message) {
  return new Promise((resolve, reject) => {
    try {
      let msisdn = String(phoneNumber || '').replace(/[^\d+]/g, '');
      if (msisdn.startsWith('+')) msisdn = msisdn.slice(1);
      if (msisdn.startsWith('0')) {
        msisdn = '60' + msisdn.slice(1);
      } else if (!msisdn.startsWith('60')) {
        if (msisdn.startsWith('1')) {
          msisdn = '60' + msisdn;
        }
      }

      const queryParams = new URLSearchParams({
        user: API_KEY_360,
        pass: API_SECRET_360,
        to: msisdn,
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
        res.on('data', (chunk) => { data += chunk; });
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

      req.on('error', (error) => { reject(error); });
      req.write(bodyStr);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 使用 HTTPS 发送 SMS（基于 Infobip API）
 */
function sendSmsViaHttps(phoneNumber, message) {
  return new Promise((resolve, reject) => {
    try {
      const requestBody = JSON.stringify({
        messages: [{
          destinations: [{ to: phoneNumber.replace(/\s+/g, '') }],
          from: INFOBIP_SENDER_NUMBER.replace(/\s+/g, ''),
          text: message
        }]
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
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse Infobip response: ${data}`));
            }
          } else {
            reject(new Error(`Infobip error (${res.statusCode}): ${data}`));
          }
        });
      });

      req.on('error', (error) => { reject(error); });
      req.write(requestBody);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ===========================================
// 🔐 OTP 工具函数
// ===========================================

/**
 * 生成 OTP 码
 */
function generateOtpCode(settings = null) {
  if (settings && settings.otp && settings.otp.devMode && settings.otp.devMode.enabled) {
    console.log('[generateOtpCode] 🔧 开发模式（platform_settings）：返回固定 OTP');
    return settings.otp.devMode.fixedCode || DEV_OTP_CODE;
  }

  if (USE_DEV_OTP) {
    console.log('[generateOtpCode] 🔧 开发模式（环境变量）：返回固定 OTP');
    return DEV_OTP_CODE;
  }

  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * SHA256 哈希函数
 */
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * 格式化 OTP 消息
 */
function formatOtpMessage(template, scenarioData) {
  let message = template;

  for (const [key, value] of Object.entries(scenarioData || {})) {
    const placeholder = `{${key}}`;
    message = message.replace(new RegExp(placeholder, 'g'), value);
  }

  return message;
}

/**
 * 检查是否应该跳过 SMS 发送（测试号码）
 */
function shouldBypassSms(phoneNumber, settings) {
  if (!settings || !settings.otp || !settings.otp.devMode) {
    return false;
  }

  const bypassNumbers = settings.otp.devMode.bypassForTestNumbers || [];

  const normalizePhone = (p) => {
    if (!p) return '';
    return String(p).replace(/[^\d]/g, '');
  };

  const normalized = normalizePhone(phoneNumber);

  return bypassNumbers.some(testNumber => {
    return normalizePhone(testNumber) === normalized;
  });
}




/**
 * Cloud Function：发送 OTP（onCall 版本）
 * 
 * ✅ 支持两种场景：
 * 1. 登录场景（UniversalLogin）- 参数：{ phoneNumber, orgCode, eventCode, loginType }
 * 2. 付款场景（CustomerPayment）- 参数：{ phoneNumber, userId, scenario, scenarioData }
 */
exports.sendOtpHttp = functions.https.onRequest(async (req, res) => {
  // CORS 與方法檢查
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  console.log('[sendOtpHttp] ========== 开始处理 ==========');

  // 標準 HTTP 請求：直接從 req.body 讀取
  const requestData = req.body || {};

  console.log('[sendOtpHttp] 请求参数:', {
    phoneNumber: requestData?.phoneNumber || 'missing',
    userId: requestData?.userId || 'none',
    scenario: requestData?.scenario || 'none',
    orgCode: requestData?.orgCode || 'none',
    eventCode: requestData?.eventCode || 'none',
    loginType: requestData?.loginType || 'none',
    hasScenarioData: !!requestData?.scenarioData
  });

  try {
    let rawData = requestData;

    const phoneNumber = rawData.phoneNumber || rawData.phone || rawData.mobile || rawData.msisdn || rawData.tel || rawData.phone_number;
    const userId = rawData.userId || rawData.user_id || rawData.uid;
    const scenario = rawData.scenario;
    const scenarioData = rawData.scenarioData || rawData.payload;
    const orgCode = rawData.orgCode || rawData.org_code;
    const eventCode = rawData.eventCode || rawData.event_code;
    const loginType = rawData.loginType || rawData.login_type;

    console.log('[sendOtpHttp] 提取的參數 (normalized):', {
      phoneNumber,
      userId,
      scenario,
      orgCode,
      eventCode,
      loginType
    });

    if (!phoneNumber) {
      console.error('[sendOtpHttp] ❌ 缺少手机号，收到的 keys:', Object.keys(rawData));
      try {
        const preview = JSON.stringify(rawData);
        console.error('[sendOtpHttp] Raw data preview:', preview.slice(0, 500));
      } catch (e) {
        console.error('[sendOtpHttp] Raw data preview: <非序列化物件，包含循環結構或 Socket/HTTPParser>');
      }
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少手机号码' } });
    }

    console.log('[sendOtpHttp] ✅ 参数验证通过');

    // 测试 getPlatformSettings
    console.log('[sendOtpHttp] 调用 getPlatformSettings...');
    const settings = await getPlatformSettings();
    console.log('[sendOtpHttp] Settings:', settings ? 'Loaded' : 'Null');

    // 测试 generateOtpCode
    console.log('[sendOtpHttp] 调用 generateOtpCode...');
    const otpCode = generateOtpCode(settings);
    console.log('[sendOtpHttp] OTP Code:', otpCode);

    // 生成 session ID
    const sessionId = `otp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('[sendOtpHttp] Session ID:', sessionId);

    // 计算过期时间
    const expiryMinutes = settings?.otp?.expiryMinutes || 5;
    const expiresAt = Date.now() + (expiryMinutes * 60 * 1000);

    // ✅ 保存到 Firestore（兼容两种场景）
    const db = admin.firestore();
    const otpDoc = {
      phoneNumber,
      // ✅ 兼容登录场景：userId 默认为 'universal'
      userId: userId || 'universal',
      // ✅ 兼容登录场景：scenario 默认为 'universalLogin' 或 'login'
      scenario: scenario || (loginType ? 'login' : 'universalLogin'),
      // ✅ 兼容登录场景：scenarioData 回退到 { orgCode, eventCode }
      scenarioData: scenarioData || { orgCode, eventCode },
      otpCodeHash: sha256(otpCode),
      createdAt: Date.now(),
      expiresAt,
      status: 'pending',
      attempts: 0,
      devMode: USE_DEV_OTP || (settings?.otp?.devMode?.enabled === true),
      // ✅ 保存 orgCode 和 eventCode（用于登录场景的验证）
      orgCode: orgCode || '',
      eventCode: eventCode || ''
    };

    console.log('[sendOtpHttp] 保存 OTP Session...');
    await db.collection('otp_sessions').doc(sessionId).set(otpDoc);
    console.log('[sendOtpHttp] ✅ OTP Session 已保存');

    // ✅ 后面的 SMS 发送代码保持不变...
    // 检查是否需要发送 SMS
    const bypassSms = shouldBypassSms(phoneNumber, settings);

    if (bypassSms) {
      console.log('[sendOtpHttp] ⚠️ 测试号码，跳过 SMS 发送');
    } else if (USE_DEV_OTP) {
      // 🔧 開發模式：不發送真實 SMS，只使用固定 OTP
      console.log('[sendOtpHttp] 🔧 開發模式：跳過實際 SMS 發送，使用固定 OTP:', DEV_OTP_CODE);
    } else {
      // 生產模式：發送真實 SMS
      // 准备 SMS 消息
      let smsMessage;
      const scenarioKey = scenario || (loginType ? 'login' : 'universalLogin');
      const messageTemplate = settings?.otp?.messageTemplates?.[scenarioKey];

      if (messageTemplate) {
        smsMessage = formatOtpMessage(messageTemplate, {
          ...scenarioData,
          otp: otpCode
        });
      } else {
        // 默认消息
        smsMessage = `您的MyBazaar验证码是：${otpCode}。有效期${expiryMinutes}分钟。`;
      }

      console.log('[sendOtpHttp] SMS 消息:', smsMessage);

      // 发送 SMS
      try {
        console.log('[sendOtpHttp] 开始发送 SMS...');

        if (SMS_PROVIDER === '360') {
          console.log('[sendOtpHttp] 使用 360 API');
          const result = await sendSmsVia360(phoneNumber, smsMessage);
          console.log('[sendOtpHttp] ✅ SMS 发送成功（360）:', result);
        } else if (SMS_PROVIDER === 'infobip') {
          console.log('[sendOtpHttp] 使用 Infobip API');
          const result = await sendSmsViaHttps(phoneNumber, smsMessage);
          console.log('[sendOtpHttp] ✅ SMS 发送成功（Infobip）:', result);
        } else {
          console.warn('[sendOtpHttp] ⚠️ 未知的 SMS_PROVIDER:', SMS_PROVIDER);
        }
      } catch (smsError) {
        console.error('[sendOtpHttp] ⚠️ SMS 发送失败:', smsError);
        console.error('[sendOtpHttp] Error details:', smsError.message);

        // ⚠️ 生産模式：SMS 失敗要拋錯
        throw new functions.https.HttpsError('internal', `SMS 发送失败: ${smsError.message}`);
      }
    }

    // ✅ 返回结果
    console.log('[sendOtpHttp] ========== 处理完成 ==========');

    const response = {
      success: true,
      otpRequired: true,
      sessionId,
      expiresIn: expiryMinutes * 60,
      message: '验证码已发送'
    };

    // 开发模式：返回 OTP 供测试
    if (USE_DEV_OTP || bypassSms) {
      response.testOtp = otpCode;
      response.devMode = true;
    }

    console.log('[sendOtpHttp] Response:', response);
    return res.status(200).json(response);

  } catch (error) {
    console.error('[sendOtpHttp] ========== 错误 ==========');
    console.error('[sendOtpHttp] Error name:', error.name);
    console.error('[sendOtpHttp] Error message:', error.message);
    console.error('[sendOtpHttp] Error stack:', error.stack);

    // 轉換為 HTTP 錯誤回應
    if (error instanceof functions.https.HttpsError) {
      const code = error.code || 'internal';
      const statusMap = {
        'invalid-argument': 400,
        'failed-precondition': 400,
        'permission-denied': 403,
        'not-found': 404,
        'deadline-exceeded': 408,
        'resource-exhausted': 429,
        'internal': 500
      };
      const status = statusMap[code] || 500;
      return res.status(status).json({ error: { code, message: error.message } });
    }

    return res.status(500).json({ error: { code: 'internal', message: `发送 OTP 失败: ${error.message}` } });
  }
});




// ===========================================
// verifyOtpHttp 保持不变（太长了，这里省略）
// ===========================================
// ... 其他代码保持原样 ...

// ===========================================
// ✅ HTTP 函数：验证 OTP（扩展版）
// ===========================================

/**
 * HTTP 函数：验证 OTP
 * 
 * 支持两种验证方式：
 * 1. 使用 sessionId 验证（推荐，新方式）
 *    Body: { sessionId, otp }
 * 
 * 2. 使用 phoneNumber + orgCode + eventCode 验证（兼容旧方式）
 *    Body: { phoneNumber, otp, orgCode, eventCode }
 * 
 * @example 新方式（推荐）
 * POST /api/verifyOtpHttp
 * { sessionId: "user123_customerPayment_1234567890", otp: "223344" }
 * 
 * @example 旧方式（登录场景兼容）
 * POST /api/verifyOtpHttp
 * { phoneNumber: "+60123456789", otp: "223344", orgCode: "chhs", eventCode: "ban" }
 */
exports.verifyOtpHttp = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  try {
    const {
      sessionId,      // 新方式：直接使用 sessionId
      phoneNumber,    // 旧方式：手机号
      otp,            // OTP 码
      orgCode,        // 旧方式：组织代码
      eventCode       // 旧方式：活动代码
    } = req.body;

    if (!otp) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少验证码' } });
    }

    if (otp.length !== 6 || !/^\d+$/.test(otp)) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '验证码格式不正确' } });
    }

    const db = admin.firestore();
    let otpDoc = null;
    let otpData = null;

    // === 方式1：使用 sessionId 查询（新方式，推荐）===
    if (sessionId) {
      console.log('[verifyOtpHttp] 使用 sessionId 验证:', sessionId);

      const docSnap = await db.collection('otp_sessions').doc(sessionId).get();
      if (docSnap.exists) {
        otpDoc = docSnap;
        otpData = docSnap.data();
      }
    }
    // === 方式2：使用 phoneNumber 查询（旧方式，兼容）===
    else if (phoneNumber) {
      console.log('[verifyOtpHttp] 使用 phoneNumber 验证（兼容模式）');

      const otpSnapshot = await db.collection('otp_sessions')
        .where('phoneNumber', '==', phoneNumber)
        .where('orgCode', '==', orgCode || '')
        .where('eventCode', '==', eventCode || '')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (!otpSnapshot.empty) {
        otpDoc = otpSnapshot.docs[0];
        otpData = otpDoc.data();
      }
    }

    // === 验证 OTP Session 是否存在 ===
    if (!otpDoc || !otpData) {
      console.warn('[verifyOtpHttp] ❌ OTP Session 不存在');
      return res.status(404).json({
        error: { code: 'not-found', message: '验证码不存在或已过期' }
      });
    }

    // === 检查过期 ===
    if (Date.now() > otpData.expiresAt) {
      console.warn('[verifyOtpHttp] ❌ OTP 已过期');
      await otpDoc.ref.update({ status: 'expired' });
      return res.status(400).json({
        error: { code: 'deadline-exceeded', message: '验证码已过期，请重新申请' }
      });
    }

    // === 检查状态 ===
    if (otpData.status === 'verified') {
      console.warn('[verifyOtpHttp] ❌ OTP 已使用');
      return res.status(400).json({
        error: { code: 'failed-precondition', message: '验证码已使用，请重新申请' }
      });
    }

    if (otpData.status === 'locked') {
      console.warn('[verifyOtpHttp] ❌ OTP 已锁定');
      return res.status(429).json({
        error: { code: 'resource-exhausted', message: '尝试次数过多，请重新申请验证码' }
      });
    }

    // === 检查尝试次数 ===
    const settings = await getPlatformSettings();
    const maxAttempts = settings?.otp?.maxAttempts || 5;

    if ((otpData.attempts || 0) >= maxAttempts) {
      console.warn('[verifyOtpHttp] ❌ OTP 尝试次数过多');
      await otpDoc.ref.update({ status: 'locked' });
      return res.status(429).json({
        error: { code: 'resource-exhausted', message: '尝试次数过多，请重新申请验证码' }
      });
    }

    // === 验证 OTP 码 ===
    const inputOtpHash = sha256(otp);
    if (inputOtpHash !== otpData.otpCodeHash) {
      const newAttempts = (otpData.attempts || 0) + 1;
      await otpDoc.ref.update({ attempts: newAttempts });

      console.warn('[verifyOtpHttp] ❌ OTP 错误, 尝试次数:', newAttempts);
      return res.status(403).json({
        error: {
          code: 'permission-denied',
          message: `验证码错误，剩余尝试次数：${maxAttempts - newAttempts}`
        }
      });
    }

    console.log('[verifyOtpHttp] ✅ OTP 验证通过');

    // === 标记为已验证 ===
    await otpDoc.ref.update({
      status: 'verified',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // === 判断场景类型 ===
    const isLoginScenario = otpData.scenario === 'login' || (otpData.orgCode && otpData.eventCode);

    // === 登录场景：生成 Custom Token（兼容旧逻辑）===
    if (isLoginScenario) {
      console.log('[verifyOtpHttp] 登录场景，执行完整用户验证...');

      // 查找组织
      const orgQuery = await db.collection('organizations')
        .where('orgCode', '==', otpData.orgCode)
        .limit(1)
        .get();

      if (orgQuery.empty) {
        console.warn('[verifyOtpHttp] ❌ 组织不存在:', otpData.orgCode);
        return res.status(404).json({ error: { code: 'not-found', message: '组织不存在' } });
      }

      const organizationId = orgQuery.docs[0].id;

      // 查找活动
      const eventQuery = await db
        .collection('organizations').doc(organizationId)
        .collection('events')
        .where('eventCode', '==', otpData.eventCode)
        .limit(1)
        .get();

      if (eventQuery.empty) {
        console.warn('[verifyOtpHttp] ❌ 活动不存在:', otpData.eventCode);
        return res.status(404).json({ error: { code: 'not-found', message: '活动不存在' } });
      }

      const eventId = eventQuery.docs[0].id;

      // 查找用户（保留原有逻辑）
      const normalizePhone = (p) => {
        if (!p) return '';
        let digits = String(p).replace(/[^0-9]/g, '');
        if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2);
        if (digits.startsWith('0')) digits = digits.substring(1);
        return digits;
      };

      const targetPhone = normalizePhone(otpData.phoneNumber);
      const variants = [
        targetPhone,
        `0${targetPhone}`,
        `60${targetPhone}`,
        `+60${targetPhone}`,
        otpData.phoneNumber
      ];

      let userData = null;
      let userId = null;
      let userDoc = null;

      for (const variant of variants) {
        const userSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users')
          .where('basicInfo.phoneNumber', '==', variant)
          .limit(1)
          .get();

        if (!userSnapshot.empty) {
          userDoc = userSnapshot.docs[0];
          userData = userDoc.data();
          userId = userDoc.id;
          console.log('[verifyOtpHttp] ✅ 用户找到:', { userId, roles: userData.roles });
          break;
        }
      }

      if (!userData) {
        console.warn('[verifyOtpHttp] ❌ 用户不存在');
        return res.status(404).json({ error: { code: 'not-found', message: '该手机号未在此活动中注册' } });
      }

      // 验证角色
      const userRoles = userData.roles || [];
      const allowedRoles = [
        'eventManager', 'financeManager', 'sellerManager',
        'merchantManager', 'customerManager',
        'seller', 'merchant', 'customer'
      ];

      const hasValidRole = userRoles.some(role => allowedRoles.includes(role));

      if (!hasValidRole || userRoles.length === 0) {
        console.warn('[verifyOtpHttp] ❌ 用户没有有效角色');
        return res.status(403).json({
          error: { code: 'permission-denied', message: '您没有访问此活动的权限' }
        });
      }

      // 生成 Custom Token
      const managedDepartments = userData.sellerManager?.managedDepartments ||
        userData.roleSpecificData?.sellerManager?.managedDepartments || [];

      const customClaims = {
        organizationId, eventId, userId,
        roles: userRoles,
        managedDepartments,
        department: userData.identityInfo?.department || '',
        identityTag: userData.identityTag || userData.identityInfo?.identityTag || '',
        orgCode: otpData.orgCode,
        eventCode: otpData.eventCode
      };

      const customToken = await admin.auth().createCustomToken(userId, customClaims);

      // 更新最后登录时间
      await userDoc.ref.update({
        'accountStatus.lastLogin': admin.firestore.FieldValue.serverTimestamp()
      });

      // 删除 OTP Session
      await otpDoc.ref.delete();

      return res.status(200).json({
        success: true,
        verified: true,
        message: '验证成功',
        scenario: 'login',

        // 登录信息
        customToken,
        userId,
        organizationId,
        eventId,
        roles: userRoles,
        englishName: userData.basicInfo?.englishName || '',
        chineseName: userData.basicInfo?.chineseName || '',
        managedDepartments,
        department: userData.identityInfo?.department || '',
        identityTag: userData.identityTag || userData.identityInfo?.identityTag || '',

        phoneNumber: otpData.phoneNumber,
        devMode: otpData.devMode || false
      });
    }

    // === 通用场景：返回验证成功和场景数据 ===
    console.log('[verifyOtpHttp] ✅ 通用场景验证成功:', otpData.scenario);

    // 不删除 OTP Session，让调用方业务函数负责删除
    // 这样可以防止重复使用

    return res.status(200).json({
      success: true,
      verified: true,
      message: '验证成功',
      sessionId: otpDoc.id,
      scenario: otpData.scenario,
      scenarioData: otpData.scenarioData || {},
      userId: otpData.userId,
      phoneNumber: otpData.phoneNumber,
      devMode: otpData.devMode || false
    });

  } catch (error) {
    console.error('[verifyOtpHttp] ❌ 错误:', error);
    return res.status(500).json({
      error: { code: 'internal', message: error.message || '验证失败' }
    });
  }
});
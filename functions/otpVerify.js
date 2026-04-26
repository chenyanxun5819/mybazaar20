require('./loadEnv');
const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const {
  defineBoolean,
  defineSecret,
  defineString,
} = require('firebase-functions/params');
const crypto = require('crypto');
const admin = require('firebase-admin');
const https = require('https');

// ===========================================
// 🔧 开发模式配置
// ===========================================

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

const SMS_SECRETS = defineSecret('SMS_SECRETS');
const API_KEY_360_SECRET = defineSecret('API_KEY_360');
const API_SECRET_360_SECRET = defineSecret('API_SECRET_360');
const USE_DEV_OTP_PARAM = defineBoolean('USE_DEV_OTP');
const DEV_OTP_CODE_PARAM = defineString('DEV_OTP_CODE', { default: '223344' });
const SMS_PROVIDER_PARAM = defineString('SMS_PROVIDER', { default: '' });
const API_BASE_URL_360_PARAM = defineString('API_BASE_URL_360', {
  default: 'https://sms.360.my/gw/bulk360/v3_0/send.php',
});

function resolveSmsProvider(explicitProvider, runtimeConfig) {
  const normalizedProvider = String(explicitProvider || '').trim().toLowerCase();
  if (normalizedProvider) return normalizedProvider;
  if (runtimeConfig.apiKey360 && runtimeConfig.apiSecret360) return '360';
  return 'disabled';
}

function readParamValue(param, fallbackValue) {
  try {
    const value = param.value();
    return value === undefined ? fallbackValue : value;
  } catch (error) {
    return fallbackValue;
  }
}

function parseSmsSecrets(rawValue, sourceLabel) {
  if (!rawValue) return {};

  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== 'string') {
    console.warn(`[SMS Config] ⚠️ ${sourceLabel} 不是有效的字串或对象`);
    return {};
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn(`[SMS Config] ⚠️ 無法解析 ${sourceLabel}，本次將回退到其他來源`);
    return {};
  }
}

function getSmsSecrets() {
  const directApiKey = String(readParamValue(API_KEY_360_SECRET, process.env.API_KEY_360 || '') || '').trim();
  const directApiSecret = String(readParamValue(API_SECRET_360_SECRET, process.env.API_SECRET_360 || '') || '').trim();

  if (directApiKey && directApiSecret) {
    return {
      apiKey360: directApiKey,
      apiSecret360: directApiSecret,
    };
  }

  let parsedSecrets = {};

  try {
    parsedSecrets = parseSmsSecrets(SMS_SECRETS.value(), 'SMS_SECRETS secret');
  } catch (error) {
    if (process.env.SMS_SECRETS) {
      parsedSecrets = parseSmsSecrets(process.env.SMS_SECRETS, 'process.env.SMS_SECRETS');
    }
  }

  return {
    apiKey360: String(parsedSecrets.API_KEY_360 || process.env.API_KEY_360 || '').trim(),
    apiSecret360: String(parsedSecrets.API_SECRET_360 || process.env.API_SECRET_360 || '').trim(),
  };
}

function getRuntimeSmsConfig() {
  const secrets = getSmsSecrets();
  const useDevOtp = parseBooleanEnv(
    readParamValue(USE_DEV_OTP_PARAM, process.env.USE_DEV_OTP),
    false
  );
  const rawDevOtpCode = String(
    readParamValue(DEV_OTP_CODE_PARAM, process.env.DEV_OTP_CODE || '223344') || '223344'
  ).trim();

  const runtimeConfig = {
    useDevOtp,
    devOtpCode: /^\d{6}$/.test(rawDevOtpCode) ? rawDevOtpCode : '223344',
    apiKey360: secrets.apiKey360,
    apiSecret360: secrets.apiSecret360,
    apiBaseUrl360: String(
      readParamValue(
        API_BASE_URL_360_PARAM,
        process.env.API_BASE_URL_360 || 'https://sms.360.my/gw/bulk360/v3_0/send.php'
      ) || 'https://sms.360.my/gw/bulk360/v3_0/send.php'
    ).trim(),
  };

  runtimeConfig.smsProvider = resolveSmsProvider(
    readParamValue(SMS_PROVIDER_PARAM, process.env.SMS_PROVIDER || ''),
    runtimeConfig
  );

  return runtimeConfig;
}

function logRuntimeSmsConfig(runtimeConfig) {
  console.log('[SMS Config] USE_DEV_OTP:', runtimeConfig.useDevOtp);
  if (runtimeConfig.useDevOtp) {
    console.warn('[SMS Config] 🔧 开发模式已开启：OTP 将不会透过真实短信发送');
  }

  console.log('[SMS Config] SMS_PROVIDER:', runtimeConfig.smsProvider);
  if (!runtimeConfig.useDevOtp && runtimeConfig.smsProvider === 'disabled') {
    console.warn('[SMS Config] ⚠️ 未配置可用的 SMS 提供商，真实 OTP 短信将无法发送');
  }
}

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
function sendSmsVia360(phoneNumber, message, runtimeConfig) {
  return new Promise((resolve, reject) => {
    try {
      if (!runtimeConfig.apiKey360 || !runtimeConfig.apiSecret360) {
        reject(new Error('缺少 360 SMS 配置，请设置 API_KEY_360 与 API_SECRET_360'));
        return;
      }

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
        user: runtimeConfig.apiKey360,
        pass: runtimeConfig.apiSecret360,
        to: msisdn,
        text: message,
        detail: '1'
      });

      const bodyStr = queryParams.toString();

      const endpoint = new URL(runtimeConfig.apiBaseUrl360);
      const options = {
        hostname: endpoint.hostname,
        port: 443,
        path: endpoint.pathname || '/gw/bulk360/v3_0/send.php',
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
              const providerError = new Error(`360 API error (code=${result.code}): ${result.desc || data}`);
              providerError.provider = '360';
              providerError.providerCode = Number(result.code);
              providerError.providerDesc = result.desc || '';
              providerError.providerBalance = result.balance;
              providerError.providerCurrency = result.currency;
              reject(providerError);
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



// ===========================================
// 🔐 OTP 工具函数
// ===========================================

/**
 * 生成 OTP 码
 * @param {object} settings - Platform设置
 * @param {object} eventSettings - Event级别的OTP设置（优先级高于Platform设置）
 */
function generateOtpCode(settings = null, eventSettings = null, runtimeConfig = {}) {
  if (runtimeConfig.useDevOtp) {
    console.log('[generateOtpCode] 🔧 环境变量：返回固定 OTP');
    return runtimeConfig.devOtpCode;
  }

  // ✅ 优先检查 Event 级别的设置
  if (eventSettings && eventSettings.enabled === false) {
    console.log('[generateOtpCode] 🔧 Event设置：使用开发OTP (Event未启用真实OTP)');
    return runtimeConfig.devOtpCode || '223344';
  }
  
  if (eventSettings && eventSettings.enabled === true) {
    console.log('[generateOtpCode] 📱 Event设置：使用真实OTP (Event已启用真实OTP)');
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 如果没有Event设置，回退到Platform设置
  if (settings && settings.otp && settings.otp.devMode && settings.otp.devMode.enabled) {
    console.log('[generateOtpCode] 🔧 Platform设置：返回固定 OTP');
    return settings.otp.devMode.fixedCode || runtimeConfig.devOtpCode || '223344';
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
exports.sendOtpHttp = onRequest({ secrets: [SMS_SECRETS, API_KEY_360_SECRET, API_SECRET_360_SECRET] }, async (req, res) => {
  // CORS 與方法檢查
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  console.log('[sendOtpHttp] ========== 开始处理 ==========');
  const runtimeConfig = getRuntimeSmsConfig();
  logRuntimeSmsConfig(runtimeConfig);
  const { useDevOtp, devOtpCode, smsProvider } = runtimeConfig;

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

    // ========== 步驟1: 获取 Platform Settings ==========
    console.log('[sendOtpHttp] 调用 getPlatformSettings...');
    const settings = await getPlatformSettings();
    console.log('[sendOtpHttp] Platform Settings:', settings ? 'Loaded' : 'Null');

    // ========== ✨ 步驟2: 获取 Event 级别的 OTP 设置（如果有 orgCode 和 eventCode）==========
    let eventOtpSettings = null;
    if (orgCode && eventCode) {
      try {
        const db = admin.firestore();
        console.log('[sendOtpHttp] 查询 Event OTP 设置:', { orgCode, eventCode });
        
        // 查找组织
        const orgQuery = await db.collection('organizations')
          .where('orgCode', '==', orgCode.toLowerCase())
          .limit(1)
          .get();
        
        if (!orgQuery.empty) {
          const orgId = orgQuery.docs[0].id;
          
          // 查找活动
          const eventQuery = await db
            .collection('organizations').doc(orgId)
            .collection('events')
            .where('eventCode', '==', eventCode)
            .limit(1)
            .get();
          
          if (!eventQuery.empty) {
            const eventData = eventQuery.docs[0].data();
            eventOtpSettings = eventData.otpSettings || null;
            console.log('[sendOtpHttp] Event OTP Settings:', eventOtpSettings);
          } else {
            console.warn('[sendOtpHttp] Event 未找到:', eventCode);
          }
        } else {
          console.warn('[sendOtpHttp] Organization 未找到:', orgCode);
        }
      } catch (error) {
        console.error('[sendOtpHttp] 获取 Event OTP 设置失败:', error);
        // 继续执行，使用默认设置
      }
    }

    // ========== 步驟3: 生成 OTP Code（优先使用Event设置）==========
    console.log('[sendOtpHttp] 调用 generateOtpCode...');
    const otpCode = generateOtpCode(settings, eventOtpSettings, runtimeConfig);
    console.log('[sendOtpHttp] OTP Code generated');
    
    // ========== 步驟4: 决定是否发送真实SMS ==========
    // 如果Event明确启用了真实OTP，则发送真实短信
    const shouldSendRealSms = eventOtpSettings?.enabled === true && !useDevOtp;
    console.log('[sendOtpHttp] 是否发送真实SMS:', shouldSendRealSms);

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
      devMode: useDevOtp || eventOtpSettings?.enabled === false || (settings?.otp?.devMode?.enabled === true),
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
    } else if (!shouldSendRealSms && useDevOtp) {
      // 🔧 开发模式 OR Event未启用真实OTP：不发送真实 SMS
      console.log('[sendOtpHttp] 🔧 开发模式 OR Event未启用真实OTP：跳过实际 SMS 发送，使用固定 OTP:', devOtpCode);
    } else if (shouldSendRealSms) {
      // ✅ Event启用了真实OTP：发送真实 SMS
      console.log('[sendOtpHttp] 📱 Event已启用真实OTP：发送真实短信');
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

      console.log('[sendOtpHttp] SMS 消息模板已准备');

      // 发送 SMS
      try {
        console.log('[sendOtpHttp] 开始发送 SMS...');

        if (smsProvider === 'disabled') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            '未配置可用的 SMS 提供商，请先设置 Firebase params / Secret Manager'
          );
        }

        if (smsProvider === '360') {
          console.log('[sendOtpHttp] 使用 360 API');
          const result = await sendSmsVia360(phoneNumber, smsMessage, runtimeConfig);
          console.log('[sendOtpHttp] ✅ SMS 发送成功（360）:', result);

        } else {
          console.warn('[sendOtpHttp] ⚠️ 未知的 SMS_PROVIDER:', smsProvider);
        }
      } catch (smsError) {
        console.error('[sendOtpHttp] ⚠️ SMS 发送失败:', smsError);
        console.error('[sendOtpHttp] Error details:', smsError.message);

        if (smsError && smsError.provider === '360' && smsError.providerCode === 402) {
          const balanceText = smsError.providerBalance != null
            ? `（当前余额: ${smsError.providerBalance}${smsError.providerCurrency ? ` ${smsError.providerCurrency}` : ''}）`
            : '';
          throw new functions.https.HttpsError(
            'resource-exhausted',
            `SMS 发送失败：360 账户点数不足${balanceText}`
          );
        }

        if (smsError && smsError.provider === '360' && smsError.providerCode === 403) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'SMS 发送失败：360 API 未启用或服务器 IP 未加入白名单'
          );
        }

        // ⚠️ 其他错误
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
    if (useDevOtp || bypassSms || !shouldSendRealSms) {
      response.testOtp = otpCode;
      response.devMode = true;
    }

    console.log('[sendOtpHttp] Response:', {
      ...response,
      testOtp: response.testOtp ? '[hidden]' : undefined
    });
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
exports.verifyOtpHttp = onRequest(async (req, res) => {
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
    // 仅当 scenario 明确为 login 时，才执行“登录场景：生成 Custom Token”。
    // universalLogin 等场景只做 OTP 验证，不应强制去 users 集合查找（eventManager 可能不在 users）。
    const isLoginScenario = otpData.scenario === 'login' || otpData.scenario === 'universalLogin';

    // === 登录场景：生成 Custom Token（兼容旧逻辑）===
    if (isLoginScenario) {
      console.log('[verifyOtpHttp] 登录场景，执行完整用户验证...', { scenario: otpData.scenario });

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

      // 查找活动 (支持多个同名活动)
      const eventQuery = await db
        .collection('organizations').doc(organizationId)
        .collection('events')
        .where('eventCode', '==', otpData.eventCode)
        .get();

      if (eventQuery.empty) {
        console.warn('[verifyOtpHttp] ❌ 活动不存在:', otpData.eventCode);
        return res.status(404).json({ error: { code: 'not-found', message: '活动不存在' } });
      }

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
      let eventId = null;

      // 遍历所有匹配的活动，查找用户
      for (const eventDoc of eventQuery.docs) {
        const currentEventId = eventDoc.id;
        
        for (const variant of variants) {
          const userSnapshot = await db
            .collection('organizations').doc(organizationId)
            .collection('events').doc(currentEventId)
            .collection('users')
            .where('basicInfo.phoneNumber', '==', variant)
            .limit(1)
            .get();

          if (!userSnapshot.empty) {
            userDoc = userSnapshot.docs[0];
            userData = userDoc.data();
            userId = userDoc.id;
            eventId = currentEventId; // 找到用户所在的活动 ID
            console.log('[verifyOtpHttp] ✅ 用户找到:', { userId, eventId, roles: userData.roles });
            break;
          }
        }
        if (userData) break;
      }

      if (!userData) {
        console.warn('[verifyOtpHttp] ❌ 用户不存在');
        return res.status(404).json({ error: { code: 'not-found', message: '该手机号未在此活动中注册' } });
      }

      // 验证角色
      const userRoles = userData.roles || [];
      const allowedRoles = [
        'eventManager', 'cashier', 'financeManager', 'teamLeader',
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
      const managedDepartments = userData.teamLeader?.managedDepartments ||
        userData.roleSpecificData?.teamLeader?.managedDepartments || [];

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

      const hasDefaultPassword = userData.basicInfo?.hasDefaultPassword === true;
      const isFirstLogin = userData.basicInfo?.isFirstLogin === true;
      const hasTransactionPin = !!userData.basicInfo?.transactionPinHash;
      const needsPasswordSetup = isFirstLogin || !hasTransactionPin;

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
        needsPasswordSetup,
        hasDefaultPassword,
        isFirstLogin,
        hasTransactionPin,

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
      // ✅ 修正：如果是 'universal' 占位符，则返回 null，让前端使用 userData 中的真实 userId
      userId: otpData.userId === 'universal' ? null : otpData.userId,
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
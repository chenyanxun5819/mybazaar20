const functions = require('firebase-functions');
const crypto = require('crypto');
const admin = require('firebase-admin');
const https = require('https');
require('dotenv').config();

// ===========================================
// 🔧 开发模式配置
// ===========================================
// 设置为 true：使用固定 OTP 223344（节省测试费用）
// 设置为 false：使用真实 SMS OTP（生产环境）
const USE_DEV_OTP = process.env.USE_DEV_OTP === 'true' || true; // 默认开启开发模式
const DEV_OTP_CODE = '223344'; // 固定的开发 OTP

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

/**
 * 生成 OTP 码
 */
function generateOtpCode() {
  if (USE_DEV_OTP) {
    console.log('[generateOtpCode] 🔧 开发模式：返回固定 OTP');
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
 * HTTP 函数：发送 OTP
 * POST /api/sendOtpHttp
 * Body: { phoneNumber, orgCode, eventCode, loginType }
 */
exports.sendOtpHttp = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  try {
    const { phoneNumber, orgCode, eventCode, loginType } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少手机号码' } });
    }

    const effectiveLoginType = loginType || 'universal';
    console.log('[sendOtpHttp] 登录类型:', effectiveLoginType);

    const otpCode = generateOtpCode();
    const otpCodeHash = sha256(otpCode);
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    const db = admin.firestore();
    await db.collection('otp_sessions').doc(sessionId).set({
      sessionId,
      phoneNumber,
      orgCode: orgCode || '',
      eventCode: eventCode || '',
      loginType: effectiveLoginType,
      otpCodeHash,
      expiresAt,
      attempts: 0,
      createdAt: new Date(),
      devMode: USE_DEV_OTP
    });

    if (USE_DEV_OTP) {
      console.log('[sendOtpHttp] 🔧 开发模式：跳过真实 SMS 发送');
      console.log('[sendOtpHttp] 🔧 请使用固定 OTP:', DEV_OTP_CODE);
      
      return res.status(200).json({
        success: true,
        sessionId,
        message: `🔧 开发模式：请输入固定验证码 ${DEV_OTP_CODE}`,
        expiresIn: 300,
        devMode: true,
        devOtp: DEV_OTP_CODE
      });
    }

    // 生产模式：发送真实 SMS
    const message = `您的 MyBazaar 验证码是: ${otpCode}。有效期5分钟，请勿泄露。`;
    let smsResult;

    if (SMS_PROVIDER === '360') {
      smsResult = await sendSmsVia360(phoneNumber, message);
    } else {
      smsResult = await sendSmsViaHttps(phoneNumber, message);
    }

    console.log('[sendOtpHttp] SMS 发送成功:', smsResult);

    return res.status(200).json({
      success: true,
      sessionId,
      message: '验证码已发送',
      expiresIn: 300
    });

  } catch (error) {
    console.error('[sendOtpHttp] 错误:', error);
    return res.status(500).json({
      error: { code: 'internal', message: error.message || '发送失败' }
    });
  }
});

/**
 * HTTP 函数：验证 OTP
 * POST /api/verifyOtpHttp
 * Body: { phoneNumber, otp, orgCode, eventCode }
 * 
 * ✅ 新架构：Event Manager 在 users 集合中，通过 roles=['eventManager'] 识别
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
    const { phoneNumber, otp, orgCode, eventCode } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少手机号码或验证码' } });
    }

    if (otp.length !== 6 || !/^\d+$/.test(otp)) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '验证码格式不正确' } });
    }

    console.log('[verifyOtpHttp] 开始验证 OTP:', { phoneNumber, orgCode, eventCode });

    const db = admin.firestore();

    // 查询 OTP Session
    const otpSnapshot = await db.collection('otp_sessions')
      .where('phoneNumber', '==', phoneNumber)
      .where('orgCode', '==', orgCode || '')
      .where('eventCode', '==', eventCode || '')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (otpSnapshot.empty) {
      console.warn('[verifyOtpHttp] OTP Session 不存在');
      return res.status(404).json({ error: { code: 'not-found', message: '验证码不存在或已过期' } });
    }

    const otpDoc = otpSnapshot.docs[0];
    const otpData = otpDoc.data();

    // 检查过期
    if (Date.now() > otpData.expiresAt) {
      console.warn('[verifyOtpHttp] OTP 已过期');
      return res.status(400).json({ error: { code: 'deadline-exceeded', message: '验证码已过期，请重新申请' } });
    }

    // 检查尝试次数
    if ((otpData.attempts || 0) >= 5) {
      console.warn('[verifyOtpHttp] OTP 尝试次数过多');
      return res.status(429).json({ error: { code: 'resource-exhausted', message: '尝试次数过多，请重新申请验证码' } });
    }

    // 验证 OTP
    const inputOtpHash = sha256(otp);
    if (inputOtpHash !== otpData.otpCodeHash) {
      await otpDoc.ref.update({ attempts: (otpData.attempts || 0) + 1 });
      console.warn('[verifyOtpHttp] OTP 错误');
      return res.status(403).json({ error: { code: 'permission-denied', message: '验证码错误' } });
    }

    console.log('[verifyOtpHttp] ✅ OTP 验证通过');

    // 查找组织
    const orgQuery = await db.collection('organizations')
      .where('orgCode', '==', orgCode)
      .limit(1)
      .get();
    
    if (orgQuery.empty) {
      console.warn('[verifyOtpHttp] 组织不存在:', orgCode);
      return res.status(404).json({ error: { code: 'not-found', message: '组织不存在' } });
    }
    
    const organizationId = orgQuery.docs[0].id;
    console.log('[verifyOtpHttp] ✅ 组织找到:', organizationId);
    
    // 查找活动
    const eventQuery = await db
      .collection('organizations').doc(organizationId)
      .collection('events')
      .where('eventCode', '==', eventCode)
      .limit(1)
      .get();
    
    if (eventQuery.empty) {
      console.warn('[verifyOtpHttp] 活动不存在:', eventCode);
      return res.status(404).json({ error: { code: 'not-found', message: '活动不存在' } });
    }
    
    const eventId = eventQuery.docs[0].id;
    console.log('[verifyOtpHttp] ✅ 活动找到:', eventId);

    // 在 users 集合中查找用户（包括 Event Manager）
    const normalizePhone = (p) => {
      if (!p) return '';
      let digits = String(p).replace(/[^0-9]/g, '');
      if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2); 
      if (digits.startsWith('0')) digits = digits.substring(1);
      return digits; 
    };

    const targetPhone = normalizePhone(phoneNumber);
    const variants = [
      targetPhone,
      `0${targetPhone}`,
      `60${targetPhone}`,
      `+60${targetPhone}`,
      phoneNumber
    ];

    console.log('[verifyOtpHttp] 尝试的电话号码变体:', variants);

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
        console.log('[verifyOtpHttp] ✅ 用户找到:', { userId, variant, roles: userData.roles });
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
      console.warn('[verifyOtpHttp] ❌ 用户没有有效角色:', { userId, roles: userRoles });
      return res.status(403).json({ 
        error: { 
          code: 'permission-denied',
          message: `您没有访问此活动的权限。当前角色: ${userRoles.join(', ') || '无'}` 
        } 
      });
    }

    console.log('[verifyOtpHttp] ✅ 用户权限验证通过:', { userId, roles: userRoles });

    // 提取信息
    const managedDepartments = userData.sellerManager?.managedDepartments || 
                               userData.roleSpecificData?.sellerManager?.managedDepartments || [];
    
    // 🔥 关键修复：使用 userId（Firestore 文档 ID）作为 Custom Token 的 uid
    // userId 就是用户在 Firestore 中的唯一标识符
    const customClaims = {
      organizationId, eventId, userId,
      roles: userRoles,
      managedDepartments,
      department: userData.identityInfo?.department || '',
      identityTag: userData.identityTag || userData.identityInfo?.identityTag || '',
      orgCode, eventCode
    };
    
    console.log('[verifyOtpHttp] Custom Claims:', customClaims);
    console.log('[verifyOtpHttp] 使用 userId 生成 Custom Token:', userId);
    const customToken = await admin.auth().createCustomToken(userId, customClaims);
    console.log('[verifyOtpHttp] ✅ Custom Token 生成成功');

    // 更新最后登录
    await userDoc.ref.update({
      'accountStatus.lastLogin': admin.firestore.FieldValue.serverTimestamp()
    });

    // 删除 OTP
    await otpDoc.ref.delete();
    console.log('[verifyOtpHttp] ✅ OTP Session 已删除');

    return res.status(200).json({
      success: true,
      message: '验证成功',
      phoneNumber,
      verified: true,
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
      devMode: otpData.devMode || false
    });

  } catch (error) {
    console.error('[verifyOtpHttp] ❌ 错误:', error);
    return res.status(500).json({
      error: { code: 'internal', message: error.message || '验证失败' }
    });
  }
});
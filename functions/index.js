const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

// 确保只初始化一次
if (!admin.apps.length) {
  admin.initializeApp();
}

const { checkAdminExists, createInitialAdmin, sendOtpToPhone, verifyOtpCode, setProjectInfo, getTotalCapital, getAssignedCapitalSum, createManager } = require('./admin');
exports.checkAdminExists = checkAdminExists;
exports.createInitialAdmin = createInitialAdmin;
exports.sendOtpToPhone = sendOtpToPhone;
exports.verifyOtpCode = verifyOtpCode;
exports.setProjectInfo = setProjectInfo;
exports.getTotalCapital = getTotalCapital;
exports.getAssignedCapitalSum = getAssignedCapitalSum;
exports.createManager = createManager;

// 🔥 添加 CORS 中间件 - 按照 Gemini 建議明確配置
const cors = require('cors')({
  origin: ['http://localhost:5173', 'https://mybazaar-c4881.web.app', 'https://mybazaar-c4881.firebaseapp.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// 标准化手机号码格式
function normalizePhoneNumber(phoneNumber) {
  let cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
  
  if (cleaned.startsWith('+60')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('60')) {
    cleaned = cleaned.substring(2);
  }
  
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  return cleaned;
}

// 🔥 修复：loginWithPin 函數 - 使用 onRequest + CORS 中間件（按照 Gemini 建議）
// 🔥 修复：loginWithPin 函数 - 完整版本
exports.loginWithPin = functions.https.onRequest((req, res) => {
  // 使用 CORS 中间件处理预检请求和跨域
  cors(req, res, async () => {
    try {
      // 只接受 POST 请求
      if (req.method !== 'POST') {
        return res.status(405).json({ 
          error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
        });
      }

      // 从请求体获取数据
      const { phoneNumber, pin, organizationId, eventId } = req.body;
    
      console.log('[loginWithPin] Received:', { 
        phoneNumber, 
        organizationId, 
        eventId, 
        hasPin: !!pin,
        bodyKeys: Object.keys(req.body)
      });
    
      // 验证必填字段
      if (!phoneNumber || !pin) {
        return res.status(400).json({ 
          error: { code: 'invalid-argument', message: '请提供手机号码与密码' }
        });
      }
      if (!organizationId || !eventId) {
        return res.status(400).json({ 
          error: { code: 'invalid-argument', message: '请提供组织与活动信息' }
        });
      }
    
      // 标准化手机号码
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log('[loginWithPin] Normalized phone:', normalizedPhone);
    
      // 正确的集合路径
      const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
      console.log('[loginWithPin] Querying path:', collectionPath);
    
      // 查询时尝试多种手机号格式
      const phoneVariants = [
        normalizedPhone,
        `0${normalizedPhone}`,
        `60${normalizedPhone}`,
        `+60${normalizedPhone}`,
        phoneNumber
      ];
    
      console.log('[loginWithPin] Trying phone variants:', phoneVariants);
    
      let userDoc = null;
      let usersSnap = null;
    
      // 尝试每种格式
      for (const variant of phoneVariants) {
        usersSnap = await admin.firestore()
          .collection(collectionPath)
          .where("basicInfo.phoneNumber", "==", variant)
          .limit(1)
          .get();
      
        if (!usersSnap.empty) {
          userDoc = usersSnap.docs[0];
          console.log('[loginWithPin] Found user with phone variant:', variant);
          break;
        }
      }
    
      if (!userDoc) {
        console.log('[loginWithPin] User not found for any phone variant');
        return res.status(404).json({ 
          error: { code: 'not-found', message: '查无此手机号码' }
        });
      }
    
      const userData = userDoc.data();
      console.log('[loginWithPin] User data found:', {
        id: userDoc.id,
        phoneNumber: userData.basicInfo?.phoneNumber,
        roles: userData.roles,
        hasPasswordHash: !!userData.basicInfo?.passwordHash,
        hasPinHash: !!userData.basicInfo?.pinHash
      });
    
      // 验证密码
      const passwordSalt = userData.basicInfo?.passwordSalt || userData.basicInfo?.pinSalt;
      const storedHash = userData.basicInfo?.passwordHash || userData.basicInfo?.pinHash;
    
      if (!passwordSalt || !storedHash) {
        console.error('[loginWithPin] Missing password data:', {
          hasPasswordSalt: !!userData.basicInfo?.passwordSalt,
          hasPinSalt: !!userData.basicInfo?.pinSalt,
          hasPasswordHash: !!userData.basicInfo?.passwordHash,
          hasPinHash: !!userData.basicInfo?.pinHash
        });
        return res.status(412).json({ 
          error: { code: 'failed-precondition', message: '用户密码资料不完整' }
        });
      }
    
      const passwordHash = crypto.createHash("sha256").update(pin + passwordSalt).digest("hex");
    
      if (passwordHash !== storedHash) {
        console.log('[loginWithPin] Password mismatch');
        return res.status(403).json({ 
          error: { code: 'permission-denied', message: '密码错误' }
        });
      }
    
      // 生成或获取 authUid
      const authUid = `phone_60${normalizedPhone}`;
      console.log('[loginWithPin] Using authUid:', authUid);
    
      let userRecord;
      try {
        userRecord = await admin.auth().getUser(authUid);
        console.log('[loginWithPin] Existing auth user found');
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          console.log('[loginWithPin] Creating new auth user');
          try {
            userRecord = await admin.auth().createUser({
              uid: authUid,
              displayName: userData.basicInfo?.englishName || userData.basicInfo?.chineseName || phoneNumber,
              phoneNumber: `+60${normalizedPhone}`
            });
          } catch (createError) {
            console.error('[loginWithPin] Error creating auth user:', createError);
            // 如果创建失败（比如手机号已存在），尝试不带手机号创建
            userRecord = await admin.auth().createUser({
              uid: authUid,
              displayName: userData.basicInfo?.englishName || userData.basicInfo?.chineseName || phoneNumber
            });
          }
        } else {
          throw error;
        }
      }
    
      // 生成自定义令牌
      console.log('[loginWithPin] Creating custom token for:', authUid);
      const customToken = await admin.auth().createCustomToken(authUid, {
        orgId: organizationId,
        eventId: eventId,
        userId: userDoc.id
      });
    
      console.log('[loginWithPin] Custom token created successfully');
    
      // 更新用户文档的 authUid（如果不存在或不一致）
      const currentAuthUid = userData.authUid || userData.authId || userData.accountStatus?.authUid;
      if (currentAuthUid !== authUid) {
        console.log(`[loginWithPin] Updating authUid from ${currentAuthUid} to ${authUid}`);
        await userDoc.ref.update({ 
          authUid: authUid,
          'accountStatus.authUid': authUid,
          'accountStatus.lastLoginAt': admin.firestore.FieldValue.serverTimestamp(),
          'accountStatus.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
      }
    
      // 构建返回的用户资料
      const userProfile = {
        id: userDoc.id,
        orgId: organizationId,
        eventId: eventId,
        authUid: authUid,
        basicInfo: userData.basicInfo,
        roles: userData.roles || [],
        identityTag: userData.basicInfo?.identityTag || "",
        roleSpecificData: userData.roleSpecificData || {}
      };
    
      console.log('[loginWithPin] Login successful, returning profile');
    
      // 返回 JSON 响应
      return res.status(200).json({
        success: true,
        customToken,
        userProfile,
        chineseName: userData.basicInfo?.chineseName || "",
        roles: userData.roles || [],
        redirectUrl: getRedirectUrl(userData.roles || [])
      });
    
    } catch (error) {
      console.error('[loginWithPin] Error:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
    
      // 返回详细的错误信息
      return res.status(500).json({ 
        error: { 
          code: error.code || 'internal',
          message: error.message || '登入失败，请稍后重试',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    }
  });
});

// changePassword 函数
exports.changePassword = functions.https.onCall(async (data, context) => {
  const { phoneNumber, currentPassword, newPassword } = data;
  
  if (!phoneNumber || !currentPassword || !newPassword) {
    throw new functions.https.HttpsError("invalid-argument", "请提供手机号码、当前密码和新密码");
  }
  
  if (newPassword.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "新密码长度至少需要8个字符");
  }
  
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  
  if (!hasLetter || !hasNumber) {
    throw new functions.https.HttpsError("invalid-argument", "新密码必须包含英文字母和数字");
  }
  
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const phoneVariants = [
      normalizedPhone,
      `0${normalizedPhone}`,
      `60${normalizedPhone}`,
      phoneNumber
    ];
    
    let userDoc = null;
    
    for (const variant of phoneVariants) {
      const usersSnap = await admin.firestore().collection("users")
        .where("basicInfo.phoneNumber", "==", variant)
        .limit(1)
        .get();
      
      if (!usersSnap.empty) {
        userDoc = usersSnap.docs[0];
        break;
      }
    }
    
    if (!userDoc) {
      throw new functions.https.HttpsError("not-found", "查无此手机号码");
    }
    
    const userData = userDoc.data();
    
    const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
    const currentPasswordHash = crypto.createHash("sha256").update(currentPassword + passwordSalt).digest("hex");
    
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "当前密码错误");
    }
    
    const newPasswordHash = crypto.createHash("sha256").update(newPassword + passwordSalt).digest("hex");
    
    await userDoc.ref.update({
      "basicInfo.passwordHash": newPasswordHash,
      "basicInfo.pinHash": newPasswordHash,
      "basicInfo.passwordSalt": passwordSalt,
      "basicInfo.pinSalt": passwordSalt
    });
    
    console.log(`[changePassword] Password changed for ${phoneNumber}`);
    return { success: true, message: "密码修改成功" };
    
  } catch (error) {
    console.error("[changePassword] Error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", `修改密码失败：${error.message}`);
  }
});

function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  if (!roles || !Array.isArray(roles)) return "../home/index.html";
  
  if (roles.includes("super_admin") || roles.includes("super admin")) return "../admin/admin-dashboard.html";
  if (roles.includes("manager")) return "../manager/admin-manage-users.html";
  if (roles.includes("merchant")) return "../merchant/merchant-dashboard.html";
  if (roles.includes("seller")) return "../seller/seller-dashboard.html";
  if (roles.includes("customer")) return "../customer/consume.html";
  
  console.log(`[getRedirectUrl] No role matched, returning default`);
  return "../home/index.html";
}

exports.loginAndRedirect = functions.https.onCall(async (data, context) => {
  const userUid = context.auth ? context.auth.uid : null;
  console.log(`[loginAndRedirect] User UID from context: ${userUid}`);
  
  const { phoneNumber } = data;
  
  let userSnap;
  if (userUid) {
    userSnap = await admin.firestore().collection("users").where("authUid", "==", userUid).limit(1).get();
  }
  
  if ((!userSnap || userSnap.empty) && phoneNumber) {
    console.log(`[loginAndRedirect] Fallback to phoneNumber query: ${phoneNumber}`);
    userSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
  }
  
  console.log(`[loginAndRedirect] Query result: ${userSnap && !userSnap.empty ? 'found' : 'empty'}`);
  if (!userSnap || userSnap.empty) throw new functions.https.HttpsError("not-found", "找不到使用者资料。");
  
  const userData = userSnap.docs[0].data();
  return {
    redirectUrl: getRedirectUrl(userData.roles),
    chineseName: userData.basicInfo && userData.basicInfo.chineseName ? userData.basicInfo.chineseName : "",
    roles: userData.roles,
    identityTag: userData.identityTag || "",
  };
});

exports.getManagers = functions.https.onCall(async (data, context) => {
  try {
    const managersSnap = await admin.firestore().collection("managers").get();
    const managers = [];

    managersSnap.forEach(doc => {
      managers.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return { managers };
  } catch (error) {
    console.error("Error fetching managers:", error);
    throw new functions.https.HttpsError("internal", "Unable to fetch managers.");
  }
});


require('./loadEnv');
const functions = require('firebase-functions');
// removed unused onDocumentCreated import (not used in this file)
const { setGlobalOptions } = require('firebase-functions/v2');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors');

// 设置全局选项，确保 v2 触发器使用正确的区域
setGlobalOptions({ region: 'asia-southeast1' });

// 確保只初始化一次
// Last deploy: 2026-01-02 21:15
if (!admin.apps.length) {
  admin.initializeApp();
}

// 导入现有模块
const { checkAdminExists, createInitialAdmin, setProjectInfo, getTotalCapital, getAssignedCapitalSum, createManager,
  createUserByEventManagerHttp, deleteEventHttp, checkDuplicateUsers, addDepartment, deleteDepartment, reorderDepartments, departmentsHttp, batchImportUsersHttp, updateUserRoles, createEventByPlatformAdmin, createEventByPlatformAdminHttp, allocatePointsHttp, recallPointsHttp, submitCashToFinanceHttp } = require('./admin');
const { loginUniversalHttp } = require('./auth/loginUniversalHttp');
const { resolveOrgEventHttp } = require('./auth/resolveOrgEventHttp');
const { sendOtpHttp, verifyOtpHttp } = require('./otpVerify');
// 导入现金收款 Cloud Functions
const { onCashCollection } = require('./src/teamLeader/onCashCollection');


// 導入 Platform Admin logo 和活動管理函數
const {
  updateOrganizationLogoHttp,
  updateEventLogoHttp,
  updateEventDetailsHttp,
  resetEventUsersHttp
} = require('./src/platform/admin_logo_event_functions');

// Event Manager Functions
const { grantPointsByEventManagerHttp } = require('./src/eventManager/grantPointsByEventManagerHttp');
// Cashier callable / triggers
const financeManagerFunctions = require('./src/cashier/cashierFunction');

const teamLeaderFunctions = require('./src/teamLeader/teamLeaderFunctions');
const teamLeaderHttpFunctions = require('./src/teamLeader/teamLeaderHttpFunctions');

// ✅ 從正確的模組導入函數
const { onTeamLeaderAllocation } = teamLeaderFunctions;
const { allocatePointsByTeamLeaderHttp, getTeamLeaderDashboardDataHttp } = teamLeaderHttpFunctions;
const { getCustomerDashboardDataHttp } = require('./src/customer/customerHttpFunctions');

// Cashier: claim + confirm cash submission (callable)
const { claimAndConfirmCashSubmission } = require('./src/cashier/Claimandconfirmcashsubmission');

// Cash Submission (callable)
const { submitCashToFinance } = require('./src/cash/Submitcashtofinance');
const { submitCashToTeamLeader } = require('./src/cash/SubmitcashtoTeamLeader');
// 新增 CashSubmission/Confirmation functions
const { createCashSubmission } = require('./src/cashSubmission/createCashSubmission');
const { confirmCashSubmissionByCashier } = require('./src/cashier/confirmCashSubmissionByCashier');

// 導入 Customer 相關 callable 函式
const {
  createCustomer,
  processCustomerPayment,
  transferPoints,
  topupFromPointCard
} = require('./src/customer/customerFunctions');

// 導入 PointSeller 相關 callable 函式
const { createPointCard } = require('./src/pointseller/createPointCard');
const { pointSellerDirectSale } = require('./src/pointseller/pointSellerDirectSale');
const { submitCashAsPointSeller } = require('./src/pointseller/submitCashAsPointSeller');
const { teamLeaderDirectSale } = require('./src/teamLeader/teamLeaderDirectSale');
// 導入密碼與交易密碼相關函式
const { changeLoginPassword: changeLoginPasswordFn } = require('./changeLoginPassword');
const { setupTransactionPin: setupTransactionPinFn } = require('./setupTransactionPin');
const { verifyTransactionPin: verifyTransactionPinFn } = require('./verifyTransactionPin');
const { resetTransactionPin: resetTransactionPinFn } = require('./resetTransactionPin');

// 導入 Merchant 相關 callable 函式
const { confirmMerchantPayment } = require('./src/merchant/confirmMerchantPayment');
const { cancelMerchantPayment } = require('./src/merchant/cancelMerchantPayment');
const { refundMerchantPayment } = require('./src/merchant/refundMerchantPayment');
const { assignMerchantAsist } = require('./src/merchant/assignMerchantAsist');
const { resetDailyMerchantRevenue } = require('./src/merchant/resetDailyMerchantRevenue');
// 導入 Merchant HTTP 函式（CRUD 操作）
const { createMerchantHttp } = require('./src/merchant/createMerchantHttp');
const { updateMerchantHttp } = require('./src/merchant/updateMerchantHttp');
const { deleteMerchantHttp } = require('./src/merchant/deleteMerchantHttp');
const { toggleMerchantStatusHttp } = require('./src/merchant/toggleMerchantStatusHttp');
// 导出现有函数
exports.checkAdminExists = checkAdminExists;
exports.createInitialAdmin = createInitialAdmin;
exports.setProjectInfo = setProjectInfo;
exports.getTotalCapital = getTotalCapital;
exports.getAssignedCapitalSum = getAssignedCapitalSum;
exports.createManager = createManager;
exports.createUserByEventManagerHttp = createUserByEventManagerHttp;
exports.deleteEventHttp = deleteEventHttp;
exports.checkDuplicateUsers = checkDuplicateUsers;
exports.addDepartment = addDepartment;
exports.deleteDepartment = deleteDepartment;
exports.reorderDepartments = reorderDepartments;
exports.departmentsHttp = departmentsHttp;
exports.batchImportUsersHttp = batchImportUsersHttp;
exports.updateUserRoles = updateUserRoles;
exports.allocatePointsHttp = allocatePointsHttp;
exports.recallPointsHttp = recallPointsHttp;
exports.loginUniversalHttp = loginUniversalHttp;
exports.resolveOrgEventHttp = resolveOrgEventHttp;
exports.sendOtpHttp = sendOtpHttp;
exports.verifyOtpHttp = verifyOtpHttp;

// 新增 Platform Admin 專用事件建立函數
exports.createEventByPlatformAdmin = createEventByPlatformAdmin;
exports.createEventByPlatformAdminHttp = createEventByPlatformAdminHttp;

// 导出现金收款 Cloud Functions
exports.onCashCollection = onCashCollection;

// 导出 Team Leader Functions
exports.teamLeaderDirectSale = teamLeaderDirectSale;
exports.onTeamLeaderAllocation = onTeamLeaderAllocation;
// exports.updateUserPointsStats = updateUserPointsStats;
// exports.checkCollectionWarnings = checkCollectionWarnings;

// 导出 Team Leader HTTP Functions
exports.allocatePointsByTeamLeaderHttp = allocatePointsByTeamLeaderHttp;
exports.getTeamLeaderDashboardDataHttp = getTeamLeaderDashboardDataHttp;
exports.getCustomerDashboardDataHttp = getCustomerDashboardDataHttp;

// 导出 Finance Manager 相关 HTTP Functions
exports.submitCashToFinanceHttp = submitCashToFinanceHttp;

// 导出 Finance Manager callable functions
// 前端 /api/getFinanceStats 期望有名為 getFinanceStats 的 function。
// cashierFunction 模組實際上導出的是 getCashierStats，因此在此建立別名以相容舊的 rewrites。
exports.getFinanceStats = financeManagerFunctions.getFinanceStats || financeManagerFunctions.getCashierStats;
exports.confirmCashSubmission = financeManagerFunctions.confirmCashSubmission;

// Cashier callable functions
exports.getCashierStats = financeManagerFunctions.getCashierStats;
exports.confirmCashSubmissionByCashier = confirmCashSubmissionByCashier;

// Finance: claim + confirm cash submission (callable)
exports.claimAndConfirmCashSubmission = claimAndConfirmCashSubmission;

// Cash Submission (callable)
exports.submitCashToFinance = submitCashToFinance;
exports.submitCashToTeamLeader = submitCashToTeamLeader;
exports.createCashSubmission = createCashSubmission;
// 將 Customer callable 以頂層名稱導出，供前端 httpsCallable 使用
exports.createCustomer = createCustomer;
exports.processCustomerPayment = processCustomerPayment;
exports.transferPoints = transferPoints;
exports.topupFromPointCard = topupFromPointCard;

// 將 PointSeller callable 以頂層名稱導出，供前端 httpsCallable 使用
exports.createPointCard = createPointCard;
exports.pointSellerDirectSale = pointSellerDirectSale;
exports.submitCashAsPointSeller = submitCashAsPointSeller;

// Point Card functions (query & payment)
const { queryPointCardBalance } = require('./src/pointCards/queryPointCardBalance');
const { processPointCardPayment } = require('./src/pointCards/processPointCardPayment');
exports.queryPointCardBalance = queryPointCardBalance;
exports.processPointCardPayment = processPointCardPayment;

// 導出密碼與交易密碼相關函式
exports.changeLoginPassword = changeLoginPasswordFn;
exports.setupTransactionPin = setupTransactionPinFn;
exports.verifyTransactionPin = verifyTransactionPinFn;
exports.resetTransactionPin = resetTransactionPinFn;

// Event Manager Functions
exports.grantPointsByEventManagerHttp = grantPointsByEventManagerHttp;

// Platform Admin Logo 和活動管理函數
exports.updateOrganizationLogoHttp = updateOrganizationLogoHttp;
exports.updateEventLogoHttp = updateEventLogoHttp;
exports.updateEventDetailsHttp = updateEventDetailsHttp;
exports.resetEventUsersHttp = resetEventUsersHttp;

// Merchant 相關 callable 函式
exports.confirmMerchantPayment = confirmMerchantPayment;
exports.cancelMerchantPayment = cancelMerchantPayment;
exports.refundMerchantPayment = refundMerchantPayment;
exports.assignMerchantAsist = assignMerchantAsist;
exports.resetDailyMerchantRevenue = resetDailyMerchantRevenue;

// Merchant HTTP 函式（CRUD 操作）
exports.createMerchantHttp = createMerchantHttp;
exports.updateMerchantHttp = updateMerchantHttp;
exports.deleteMerchantHttp = deleteMerchantHttp;
exports.toggleMerchantStatusHttp = toggleMerchantStatusHttp;

// CORS 中间件配置
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://mybazaar-c4881.web.app',
  'https://mybazaar-c4881.firebaseapp.com',
  'https://system.mybazaar.my',
  'https://demo.mybazaar.my'
];
const corsHandler = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// 簡單健康檢查（透過 Hosting 代理用於驗證 rewrites / IAM / CORS）
exports.pingHttp = onRequest({ region: 'asia-southeast1' }, (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'method-not-allowed' } });
    }

    return res.status(200).json({ ok: true, now: new Date().toISOString() });
  });
});

// 标准化手机号码格式
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  let cleaned = phoneNumber.replace(/[\s\-()]/g, '');

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

// 获取重定向 URL
function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  if (!roles || !Array.isArray(roles)) return "../home/index.html";

  if (roles.includes("super_admin") || roles.includes("super admin"))
    return "../admin/admin-dashboard.html";
  if (roles.includes("manager"))
    return "../manager/admin-manage-users.html";
  if (roles.includes("merchantOwner"))
    return "../merchant/merchant-dashboard.html";
  if (roles.includes("merchantAsist"))
    return "../merchant/merchant-dashboard.html";
  if (roles.includes("seller"))
    return "../seller/seller-dashboard.html";
  if (roles.includes("customer"))
    return "../customer/consume.html";

  console.log(`[getRedirectUrl] No role matched, returning default`);
  return "../home/index.html";
}

// 登录函数 - 使用 corsHandler
exports.loginWithPin = onRequest({ region: 'asia-southeast1' }, (req, res) => {
  corsHandler(req, res, async () => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[${requestId}] ===== LOGIN REQUEST START =====`);
    console.log(`[${requestId}] Method: ${req.method}`);

    try {
      if (req.method !== 'POST') {
        console.log(`[${requestId}] ❌ Invalid method: ${req.method}`);
        return res.status(405).json({
          error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
        });
      }

      const { phoneNumber, pin, organizationId, eventId } = req.body;

      console.log(`[${requestId}] 📥 Received data:`, {
        phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 3)}***` : 'missing',
        hasPin: !!pin,
        pinLength: pin ? pin.length : 0,
        organizationId,
        eventId
      });

      if (!phoneNumber || !pin) {
        console.log(`[${requestId}] ❌ Missing phone or pin`);
        return res.status(400).json({
          error: { code: 'invalid-argument', message: '请提供手机号码与密码' }
        });
      }

      if (!organizationId || !eventId) {
        console.log(`[${requestId}] ❌ Missing organizationId or eventId`);
        return res.status(400).json({
          error: { code: 'invalid-argument', message: '请提供组织与活动信息' }
        });
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log(`[${requestId}] 📱 Normalized phone: ${normalizedPhone}`);

      const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
      console.log(`[${requestId}] 📂 Collection path: ${collectionPath}`);

      const phoneVariants = [
        normalizedPhone,
        `0${normalizedPhone}`,
        `60${normalizedPhone}`,
        `+60${normalizedPhone}`,
        phoneNumber
      ];

      console.log(`[${requestId}] 🔍 Trying phone variants:`, phoneVariants);

      let userDoc = null;
      let _usedVariant = null;

      for (const variant of phoneVariants) {
        console.log(`[${requestId}] 🔎 Querying with variant: ${variant}`);

        try {
          const usersSnap = await admin.firestore()
            .collection(collectionPath)
            .where("basicInfo.phoneNumber", "==", variant)
            .limit(1)
            .get();

          console.log(`[${requestId}] Query result for ${variant}: ${usersSnap.size} documents`);

          if (!usersSnap.empty) {
            userDoc = usersSnap.docs[0];
            _usedVariant = variant;
            console.log(`[${requestId}] ✅ Found user with variant: ${variant}, Doc ID: ${userDoc.id}`);
            break;
          }
        } catch (queryError) {
          console.error(`[${requestId}] ❌ Query error for ${variant}:`, queryError);
        }
      }

      if (!userDoc) {
        console.log(`[${requestId}] ❌ User not found for any phone variant`);
        return res.status(404).json({
          error: { code: 'not-found', message: '查无此手机号码' }
        });
      }

      const userData = userDoc.data();
      console.log(`[${requestId}] 📄 User data structure:`, {
        id: userDoc.id,
        hasBasicInfo: !!userData.basicInfo,
        phoneNumber: userData.basicInfo?.phoneNumber,
        hasPasswordHash: !!userData.basicInfo?.passwordHash,
        hasPinHash: !!userData.basicInfo?.pinHash,
        hasPasswordSalt: !!userData.basicInfo?.passwordSalt,
        hasPinSalt: !!userData.basicInfo?.pinSalt,
        roles: userData.roles,
        topLevelKeys: Object.keys(userData)
      });

      const passwordSalt = userData.basicInfo?.passwordSalt || userData.basicInfo?.pinSalt;
      const storedHash = userData.basicInfo?.passwordHash || userData.basicInfo?.pinHash;

      if (!passwordSalt || !storedHash) {
        console.error(`[${requestId}] ❌ Missing password data`);
        return res.status(412).json({
          error: { code: 'failed-precondition', message: '用户密码资料不完整，请联系管理员' }
        });
      }

      console.log(`[${requestId}] 🔒 Computing password hash...`);
      const passwordHash = crypto.createHash("sha256")
        .update(pin + passwordSalt)
        .digest("hex");

      if (passwordHash !== storedHash) {
        console.log(`[${requestId}] ❌ Password mismatch`);
        return res.status(403).json({
          error: { code: 'permission-denied', message: '密码错误' }
        });
      }

      console.log(`[${requestId}] ✅ Password verified`);

      const authUid = `phone_60${normalizedPhone}`;
      console.log(`[${requestId}] 🔑 AuthUid: ${authUid}`);

      try {
        console.log(`[${requestId}] 🔍 Checking if auth user exists...`);
        await admin.auth().getUser(authUid);
        console.log(`[${requestId}] ✅ Existing auth user found`);
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          console.log(`[${requestId}] 📝 Creating new auth user...`);
          try {
            await admin.auth().createUser({
              uid: authUid,
              displayName: userData.basicInfo?.englishName ||
                userData.basicInfo?.chineseName ||
                phoneNumber
            });
            console.log(`[${requestId}] ✅ Auth user created`);
          } catch (createError) {
            console.error(`[${requestId}] ❌ Failed to create auth user:`, createError);
            throw createError;
          }
        } else if (error.code === 'app/invalid-credential') {
          console.warn(`[${requestId}] ⚠️ Auth not configured, skipping getUser/createUser`);
        } else {
          console.error(`[${requestId}] ❌ Auth error:`, error);
          throw error;
        }
      }

      // 🎫 構造 Custom Claims（與 otpVerify 對齊，確保 Firestore 規則可用）
      const managedDepartments = userData.teamLeader?.managedDepartments ||
        userData.roleSpecificData?.teamLeader?.managedDepartments || [];

      const customClaims = {
        organizationId,
        eventId,
        userId,
        roles: userData.roles || [],
        managedDepartments,
        department: userData.identityInfo?.department || '',
        identityTag: userData.identityTag || userData.identityInfo?.identityTag || '',
        orgCode: userData.orgCode || '',
        eventCode: userData.eventCode || ''
      };

      console.log(`[${requestId}] 🎫 Generating custom token with claims:`, customClaims);
      let customToken;
      try {
        customToken = await admin.auth().createCustomToken(authUid, customClaims);
        console.log(`[${requestId}] ✅ Custom token generated`);
      } catch (tokenError) {
        console.error(`[${requestId}] ❌ Token generation failed:`, tokenError);
        throw tokenError;
      }

      const userId = userDoc.id;
      console.log(`[${requestId}] 🔄 Updating last active time...`);

      await admin.firestore()
        .collection(collectionPath)
        .doc(userId)
        .update({ 'activityData.lastActiveAt': new Date() });

      const duration = Date.now() - startTime;
      console.log(`[${requestId}] ✅ Login successful in ${duration}ms`);
      console.log(`[${requestId}] ===== LOGIN REQUEST END =====`);

      // 🛡️ 构造安全的 userProfile 返回给前端，避免前端再次查询 Firestore
      const userProfile = {
        userId: userDoc.id,
        organizationId,
        eventId,
        roles: userData.roles || [],
        basicInfo: { ...userData.basicInfo },
        identityInfo: userData.identityInfo || {},
        identityTag: userData.identityTag || userData.identityInfo?.identityTag || '',
        teamLeader: userData.teamLeader,
        accountStatus: userData.accountStatus
      };

      // 移除敏感信息
      if (userProfile.basicInfo) {
        delete userProfile.basicInfo.passwordHash;
        delete userProfile.basicInfo.passwordSalt;
        delete userProfile.basicInfo.pinHash;
        delete userProfile.basicInfo.pinSalt;
        delete userProfile.basicInfo.transactionPinHash;
        delete userProfile.basicInfo.transactionPinSalt;
      }

      return res.status(200).json({
        success: true,
        customToken,
        userId,
        organizationId,
        eventId,
        userProfile, // ✅ 返回完整 Profile
        englishName: userData.basicInfo?.englishName || '',
        chineseName: userData.basicInfo?.chineseName || '',
        message: '登录成功',
        elapsedMs: duration
      });
    } catch (error) {
      console.error(`[${requestId}] ❌ Unexpected error:`, error);
      return res.status(500).json({
        error: {
          code: error.code || 'internal',
          message: error.message || '登录失败'
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
    const currentPasswordHash = crypto.createHash("sha256")
      .update(currentPassword + passwordSalt)
      .digest("hex");

    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "当前密码错误");
    }

    const newPasswordHash = crypto.createHash("sha256")
      .update(newPassword + passwordSalt)
      .digest("hex");

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

exports.loginAndRedirect = functions.https.onCall(async (data, context) => {
  const userUid = context.auth ? context.auth.uid : null;
  console.log(`[loginAndRedirect] User UID from context: ${userUid}`);

  const { phoneNumber } = data;

  let userSnap;
  if (userUid) {
    userSnap = await admin.firestore().collection("users")
      .where("authUid", "==", userUid)
      .limit(1)
      .get();
  }

  if ((!userSnap || userSnap.empty) && phoneNumber) {
    console.log(`[loginAndRedirect] Fallback to phoneNumber query: ${phoneNumber}`);
    userSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
  }

  console.log(`[loginAndRedirect] Query result: ${userSnap && !userSnap.empty ? 'found' : 'empty'}`);
  if (!userSnap || userSnap.empty) {
    throw new functions.https.HttpsError("not-found", "找不到使用者资料。");
  }

  const userData = userSnap.docs[0].data();
  return {
    redirectUrl: getRedirectUrl(userData.roles),
    chineseName: userData.basicInfo?.chineseName || "",
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

// functions/migrateIdentityTags.js
exports.migrateIdentityTags = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  try {
    const db = admin.firestore();

    // 获取所有 Organizations
    const orgsSnapshot = await db.collection('organizations').get();

    const batch = db.batch();
    let updateCount = 0;
    const now = new Date().toISOString(); // ✅ 使用固定的时间戳字符串

    for (const orgDoc of orgsSnapshot.docs) {
      const orgData = orgDoc.data();

      // 检查是否已有 identityTags
      if (!orgData.identityTags) {
        // ✅ 添加带新型 roleConfig 的身份标签（方案 B）
        const defaultIdentityTags = [
          {
            id: 'staff',
            name: {
              'en': 'Staff',
              'zh-CN': '职员'
            },
            displayOrder: 1,
            isActive: true,
            roleConfig: {
              roleType: 'independent',
              description: '独立身份，可直接交现金给 Cashier'
            },
            createdAt: now
          },
          {
            id: 'student',
            name: {
              'en': 'Student',
              'zh-CN': '学生'
            },
            displayOrder: 2,
            isActive: true,
            roleConfig: {
              roleType: 'managed',
              description: '需要被 Team Leader 管理的身份'
            },
            managedByRole: {
              role: 'teamLeader',
              policies: {
                requiresApprovalForCash: true,
                calculateCollectionWarning: true,
                canBatchAllocate: true,
                canExportData: true
              }
            },
            createdAt: now
          },
          {
            id: 'teacher',
            name: {
              'en': 'Teacher',
              'zh-CN': '教师'
            },
            displayOrder: 3,
            isActive: true,
            roleConfig: {
              roleType: 'independent',
              description: '独立身份，可直接交现金给 Cashier'
            },
            createdAt: now
          }
        ];

        batch.update(orgDoc.ref, {
          identityTags: defaultIdentityTags,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        updateCount++;
      }
    }

    await batch.commit();

    res.json({
      success: true,
      message: `成功更新 ${updateCount} 个组织的身份标签`,
      totalOrgs: orgsSnapshot.size,
      timestamp: now
    });

  } catch (error) {
    console.error('迁移失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// index.js

// ============================================================================
// 注意：onTeamLeaderAllocation 已迁移到 teamLeaderFunctions.js
// 该触发器已从此处删除以避免重复触发导致点数翻倍
// 请参考 teamLeaderFunctions.js 中的 onTeamLeaderAllocation 实现
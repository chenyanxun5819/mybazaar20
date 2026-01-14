const admin = require('firebase-admin');
const { updateUserCustomClaims } = require('./custom_claims_helper');  // ✅ 新增：Custom Claims 辅助函数
const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const cors = require('cors');

// 配置允許的來源
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://mybazaar-c4881.web.app',
  'https://mybazaar-c4881.firebaseapp.com'
];

const corsHandler = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

function getDb() {
  return admin.firestore();
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * 检查调用者是否是 Event Manager
 * @param {string} callerUid - 调用者的 UID
 * @param {FirebaseFirestore.DocumentReference} orgRef - 组织文档引用
 * @returns {Promise<boolean>}
 */
async function checkEventManagerPermission(callerUid, orgRef) {
  if (!callerUid) return false;

  const db = getDb();

  // 1. 检查是否为平台管理员
  try {
    const adminCheck = await db.collection('admin_uids').doc(callerUid).get();
    if (adminCheck.exists) return true;
  } catch (e) {
    console.error('[checkEventManagerPermission] Admin check error:', e);
  }

  // 解析 UID 中的电话号码
  let phoneFromUid = null;
  if (callerUid.startsWith('eventManager_')) {
    phoneFromUid = callerUid.replace('eventManager_', '');
  } else if (callerUid.startsWith('phone_')) {
    phoneFromUid = callerUid.replace('phone_', '');
  } else {
    // 尝试从 UID 中提取数字部分作为电话号码
    const match = callerUid.match(/\d+/);
    if (match) phoneFromUid = match[0];
  }

  // 标准化电话号码
  const normalizePhone = (p) => {
    if (!p) return '';
    let digits = String(p).replace(/[^0-9]/g, '');
    if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2);
    if (digits.startsWith('0')) digits = digits.substring(1);
    return digits;
  };

  const coreCaller = phoneFromUid ? normalizePhone(phoneFromUid) : null;

  // 检查所有活动的 admins 数组和 eventManager 对象
  try {
    const eventsSnapshot = await orgRef.collection('events').get();
    for (const eventDoc of eventsSnapshot.docs) {
      const eventData = eventDoc.data();

      // A. 检查 eventManager 对象
      if (eventData.eventManager) {
        // 检查 authUid
        if (eventData.eventManager.authUid === callerUid) return true;

        // 检查电话号码
        if (eventData.eventManager.phoneNumber && coreCaller) {
          const emPhone = eventData.eventManager.phoneNumber;
          const coreEM = normalizePhone(emPhone);
          if (coreCaller === coreEM) return true;
        }
      }

      // B. 检查 admins 数组
      const admins = Array.isArray(eventData.admins) ? eventData.admins : [];
      if (coreCaller) {
        for (const admin of admins) {
          const adminPhone = admin.phone || admin.phoneNumber;
          if (!adminPhone) continue;
          const coreAdmin = normalizePhone(adminPhone);
          if (coreCaller === coreAdmin) return true;
        }
      }

      // C. 检查 users 集合 (通过 authUid)
      const usersSnap = await eventDoc.ref.collection('users')
        .where('authUid', '==', callerUid)
        .get();

      if (!usersSnap.empty) {
        const userData = usersSnap.docs[0].data();
        if (userData.roles && userData.roles.includes('eventManager')) {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    console.error('[checkEventManagerPermission] Error:', error);
    return false;
  }
}


/**
 * Callable function to create/assign an Event Manager under a specific organization + event.
 * - Auth: requires caller to be a platform admin (presence in admin_uids/{uid})
 * - Data required: organizationId, eventId, phoneNumber, password, englishName
 * - Optional: chineseName, email, identityTag (default 'staff')
 * - Behavior: creates a user doc under organizations/{org}/events/{event}/users with role 'manager',
 *             sets event.eventManager, and initializes basic statistics fields.
 */
// `createEventManager` callable was removed: event manager creation is handled
// by `createEventByPlatformAdminHttp` and related flows. If you need the
// callable preserved for backward compatibility, restore from admin.js.back.

// NOTE: `createEventManagerHttp` has been removed. Use `createEventByPlatformAdminHttp` instead.



// ========== OTP 相关函数 ==========

exports.sendOtpToPhone = functions.https.onCall(async (data, context) => {
  const { phoneNumber, pinCode } = data;
  if (!phoneNumber || !pinCode) throw new functions.https.HttpsError("invalid-argument", "缺少参数");

  const usersSnap = await getDb().collection("users").where("basicInfo.phoneNumber", "==", phoneNumber).get();
  if (usersSnap.empty) throw new functions.https.HttpsError("not-found", "用户不存在");
  const userDoc = usersSnap.docs[0];
  const user = userDoc.data();

  const pinSalt = user.basicInfo && user.basicInfo.pinSalt ? user.basicInfo.pinSalt : undefined;
  const pinHash = user.basicInfo && user.basicInfo.pinHash ? user.basicInfo.pinHash : undefined;
  if (!pinSalt || !pinHash) throw new functions.https.HttpsError("failed-precondition", "PIN 资料缺失");
  if (sha256(pinCode + pinSalt) !== pinHash) throw new functions.https.HttpsError("permission-denied", "PIN 验证失败");

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const otpCodeHash = sha256(otpCode);
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  await getDb().collection("otp_collection").doc(sessionId).set({
    sessionId,
    phoneNumber,
    otpCodeHash,
    expiresAt,
    attempts: 0,
    authUid: user.authUid
  });

  console.log(`[OTP] Send to ${phoneNumber}: ${otpCode}`);
  return { sessionId };
});

exports.verifyOtpCode = functions.https.onCall(async (data, context) => {
  const { sessionId, otpCode } = data;
  if (!sessionId || !otpCode) throw new functions.https.HttpsError("invalid-argument", "缺少参数");

  const otpDocRef = getDb().collection("otp_collection").doc(sessionId);
  const otpDocSnap = await otpDocRef.get();
  if (!otpDocSnap.exists) throw new functions.https.HttpsError("not-found", "OTP session 不存在");
  const otpData = otpDocSnap.data();
  if (!otpData) throw new functions.https.HttpsError("not-found", "OTP 资料不存在");
  if (Date.now() > otpData.expiresAt) throw new functions.https.HttpsError("deadline-exceeded", "OTP 已过期");
  if (sha256(otpCode) !== otpData.otpCodeHash) {
    await otpDocRef.update({ attempts: (otpData.attempts || 0) + 1 });
    throw new functions.https.HttpsError("permission-denied", "OTP 验证失败");
  }
  const customToken = await admin.auth().createCustomToken(otpData.authUid);
  await otpDocRef.delete();
  return { customToken };
});

// ========== 管理员检查与初始化 ==========

exports.checkAdminExists = functions.https.onCall(async (data, context) => {
  try {
    const snapshot = await getDb().collection('users')
      .where('roles', 'array-contains', 'super_admin')
      .limit(1)
      .get();
    const exists = !snapshot.empty;
    return { exists };
  } catch (error) {
    throw new functions.https.HttpsError("internal", "检查管理员失败");
  }
});

exports.createInitialAdmin = functions.https.onCall(async (data, context) => {
  const actualData = data.data || data;
  const {
    phoneNumber,
    englishName,
    chineseName,
    email,
    identityTag,
    department,
    password,
    includeMerchant,
    projectInfo
  } = actualData;

  console.log('[createInitialAdmin] Received data:', {
    phoneNumber,
    englishName,
    chineseName,
    email,
    identityTag,
    department,
    hasPassword: !!password,
    includeMerchant,
    hasProjectInfo: !!projectInfo
  });

  // 验证必填字段
  if (!phoneNumber || !englishName || !email || !password || typeof phoneNumber !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', '缺少手机号码、英文姓名、邮箱或密码');
  }

  // 验证身份标签 - 只允许 staff 和 teacher
  const validIdentityTags = ['staff', 'teacher'];
  if (!identityTag || !validIdentityTags.includes(identityTag)) {
    throw new functions.https.HttpsError('invalid-argument', '请选择有效的身份标签 (staff 或 teacher)');
  }

  // 检查是否已有超级管理员
  const check = await getDb().collection('users')
    .where('roles', 'array-contains', 'super_admin')
    .limit(1)
    .get();

  if (!check.empty) {
    throw new functions.https.HttpsError('already-exists', '已有管理员,无法重复初始化');
  }

  // 处理国际电话号码格式
  const internationalPhone = phoneNumber.startsWith('+')
    ? phoneNumber
    : `+${phoneNumber.replace(/^0/, '60')}`;

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByPhoneNumber(internationalPhone);
    userRecord = await admin.auth().updateUser(userRecord.uid, {
      displayName: englishName,
      email: email
    });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      userRecord = await admin.auth().createUser({
        phoneNumber: internationalPhone,
        displayName: englishName,
        email: email
      });
    } else {
      throw error;
    }
  }

  // 生成文档ID
  const docId = `usr_${crypto.randomUUID()}`;

  // 生成密码 hash 和 salt
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = sha256(password + passwordSalt);

  // 检查文档是否已存在
  const existingUserDoc = await getDb().collection('users').doc(docId).get();
  if (existingUserDoc.exists) {
    throw new functions.https.HttpsError('already-exists', '用户文件已存在');
  }

  // 构建角色数组：super_admin + seller + customer + (可选)merchant
  const roles = ['super_admin', 'seller', 'customer'];
  if (includeMerchant) {
    roles.push('merchant');
  }

  console.log('[createInitialAdmin] Roles assigned:', roles);

  // 构建 identityInfo 基于 identityTag
  let identityInfo = {};
  let superAdminId = 'SA001';

  switch (identityTag) {
    case 'staff':
      identityInfo = {
        staffId: superAdminId,
        position: 'super_admin',
        department: department || '系统管理部'
      };
      break;
    case 'teacher':
      identityInfo = {
        teacherId: superAdminId,
        department: department || '系统管理部'
      };
      break;
  }

  // 获取总资本
  const totalCapital = projectInfo?.settings?.totalCapital || 2000000;

  // 构建 roleSpecificData - 包含所有角色的数据
  const roleSpecificData = {
    super_admin: {
      superAdminId: superAdminId,
      totalCapitalManaged: totalCapital,
      allocatedCapital: 0,
      availableCapital: totalCapital,
      totalManagersAssigned: 0,
      allocationHistory: {
        totalAllocations: 0,
        lastAllocationAt: null,
        totalReclaimed: 0
      }
    },
    seller: {
      availablePoints: 0,
      currentSalesAmount: 0,
      totalPointsSold: 0,
      capitalSource: {
        assignedBy: 'self',
        assignedAt: new Date(),
        allocationId: null
      }
    },
    customer: {
      currentBalance: 0,
      totalPointsPurchased: 0,
      totalPointsConsumed: 0
    }
  };

  // 如果包含 merchant 角色，添加 merchant 数据
  if (includeMerchant) {
    roleSpecificData.merchant = {
      totalReceivedPoints: 0,
      monthlyReceivedPoints: 0
    };
  }

  // 创建用户文档 - 完全符合新架构
  const userDoc = {
    userId: docId,
    authUid: userRecord.uid,
    roles: roles,
    identityTag: identityTag,
    basicInfo: {
      phoneNumber: phoneNumber,
      englishName: englishName,
      chineseName: chineseName || '',
      email: email,

      // 登录密码
      passwordHash: passwordHash,
      passwordSalt: passwordSalt,
      hasDefaultPassword: true,        // ← 新增
      isFirstLogin: true,              // ← 新增
      passwordLastChanged: null,       // ← 新增

      // 交易密码（初始为空）
      transactionPinHash: null,        // ← 新增
      transactionPinSalt: null,        // ← 新增
      pinFailedAttempts: 0,            // ← 新增
      pinLockedUntil: null,            // ← 新增
      pinLastChanged: null,            // ← 新增

      isPhoneVerified: true
    },
    identityInfo: identityInfo,
    roleSpecificData: roleSpecificData,
    activityData: {
      joinedAt: new Date(),
      lastActiveAt: new Date(),
      participationStatus: 'active'
    },
    accountStatus: {
      status: 'active',
      mustChangePassword: false,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    metadata: {
      registrationSource: 'initial_admin',
      operatorUid: context && context.auth && context.auth.uid ? context.auth.uid : 'system',
      notes: `系统初始化超级管理员 - 角色: ${roles.join(', ')}${department ? ' - 部门: ' + department : ''}`
    }
  };

  // 如果包含 merchant，添加 businessInfo
  if (includeMerchant) {
    userDoc.businessInfo = {
      businessType: 'general',
      operatingHours: {
        'zh-CN': '义卖会期间营业',
        'en': 'Open during charity fair'
      },
      description: {
        'zh-CN': `${department || '管理员'}档口`,
        'en': `${department || 'Administrator'} stall`
      }
    };
  }

  // 保存用户文档
  await getDb().collection('users').doc(docId).set(userDoc);

  // 保存到 admin_uids 集合
  await getDb().collection('admin_uids').doc(userRecord.uid).set({
    uid: userRecord.uid,
    englishName: englishName,
    chineseName: chineseName || '',
    email: email,
    department: department || '',
    permissions: ['all'],
    createdAt: new Date()
  });

  // 保存项目配置
  if (projectInfo) {
    try {
      console.log('[createInitialAdmin] Saving project info:', projectInfo);
      await getDb().collection('system_config').doc('project_info').set(projectInfo);
      console.log('[createInitialAdmin] Project info saved successfully');
    } catch (error) {
      console.error('[createInitialAdmin] Error saving project info:', error);
    }
  }

  // 初始化全局设置
  await getDb().collection('system_config').doc('global_settings').set({
    defaultLanguage: 'zh-CN',
    supportedLanguages: ['zh-CN', 'en'],
    timezone: 'Asia/Kuala_Lumpur',
    currency: 'MYR',
    version: '4.2.0',
    features: {
      multiLanguage: true,
      otpVerification: true,
      transactionLogging: true,
      roleBasedPermissions: true,
      multiRoleSupport: true,
      capitalAllocationTracking: true
    },
    otp: {
      enabled: true,
      expirySeconds: 300,
      maxAttempts: 5,
      provider: 'twilio'
    },
    pin: {
      minLength: 6,
      maxLength: 6,
      hashAlgorithm: 'SHA-256',
      requireOtpVerification: true
    },
    nameFields: {
      englishName: {
        required: true,
        description: {
          'zh-CN': '英文名字或拼音名字(必填)',
          'en': 'English name or romanized name (required)'
        }
      },
      chineseName: {
        required: false,
        description: {
          'zh-CN': '中文名字(选填)',
          'en': 'Chinese name (optional)'
        }
      }
    }
  });

  console.log('[createInitialAdmin] Super admin created successfully:', {
    userId: docId,
    authUid: userRecord.uid,
    englishName: englishName,
    identityTag: identityTag,
    department: department,
    roles: roles
  });

  return {
    success: true,
    userId: docId,
    authUid: userRecord.uid,
    roles: roles,
    department: department || '',
    message: '管理员创建成功,请使用手机号 + 密码登录'
  };
});

// ========== 项目配置管理 ==========

exports.setProjectInfo = functions.https.onCall(async (data, context) => {
  const { projectInfo } = data;
  if (!projectInfo) {
    throw new functions.https.HttpsError("invalid-argument", "缺少 projectInfo 资料");
  }

  try {
    await getDb().collection("system_config").doc("project_info").set(projectInfo);
    return { success: true, message: "项目配置已成功保存" };
  } catch (error) {
    console.error("保存项目配置失败:", error);
    throw new functions.https.HttpsError("internal", "保存项目配置失败", error.message);
  }
});

exports.getTotalCapital = functions.https.onCall(async (data, context) => {
  try {
    const projectInfoDoc = await getDb().collection('system_config').doc('project_info').get();

    if (!projectInfoDoc.exists) {
      throw new functions.https.HttpsError('not-found', '找不到专案配置');
    }

    const projectInfo = projectInfoDoc.data();
    const totalCapital = projectInfo.settings?.totalCapital || 0;
    const statistics = projectInfo.statistics || {};
    const assignedCapital = statistics.assignedCapital || 0;
    const availableCapital = statistics.availableCapital || totalCapital;

    console.log('[getTotalCapital] Capital info:', { totalCapital, assignedCapital, availableCapital });

    return {
      totalCapital,
      assignedCapital,
      availableCapital
    };
  } catch (error) {
    console.error('[getTotalCapital] Error:', error);
    throw new functions.https.HttpsError('internal', '取得总资本失败', error.message);
  }
});

exports.getAssignedCapitalSum = functions.https.onCall(async (data, context) => {
  try {
    const managersSnap = await getDb().collection('users')
      .where('roles', 'array-contains', 'manager')
      .get();

    let assignedSum = 0;
    managersSnap.forEach(doc => {
      const managerData = doc.data();
      assignedSum += managerData.roleSpecificData?.manager?.assignedCapital || 0;
    });

    console.log('[getAssignedCapitalSum] Assigned sum:', assignedSum);
    return { assignedSum };
  } catch (error) {
    console.error('[getAssignedCapitalSum] Error:', error);
    throw new functions.https.HttpsError('internal', '取得分配总和失败', error.message);
  }
});

// ========== Manager 管理 ==========

exports.createManager = functions.https.onCall(async (data, context) => {
  console.log('[createManager] Received request, context.auth:', context.auth ? context.auth.uid : 'null');

  const actualData = data.data || data;
  const callerUid = context.auth ? context.auth.uid : actualData.callerUid;

  console.log('[createManager] Caller UID:', callerUid);

  if (!callerUid) {
    throw new functions.https.HttpsError('unauthenticated', '必须登入才能执行此操作');
  }

  // 验证权限
  try {
    const userQuery = await getDb().collection('users')
      .where('authUid', '==', callerUid)
      .limit(1)
      .get();

    let hasPermission = false;

    if (!userQuery.empty) {
      const userData = userQuery.docs[0].data();
      console.log('[createManager] Found user by authUid:', {
        docId: userQuery.docs[0].id,
        roles: userData.roles
      });
      hasPermission = userData.roles && userData.roles.includes('super_admin');
    } else {
      const directDoc = await getDb().collection('users').doc(callerUid).get();
      if (directDoc.exists) {
        const userData = directDoc.data();
        console.log('[createManager] Found user by docId:', {
          docId: directDoc.id,
          roles: userData.roles
        });
        hasPermission = userData.roles && userData.roles.includes('super_admin');
      }
    }

    if (!hasPermission) {
      console.log('[createManager] Permission denied: User is not super_admin');
      throw new functions.https.HttpsError('permission-denied', '只有超级管理员可以建立 Manager');
    }

    console.log('[createManager] Permission check passed');
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('[createManager] Permission check error:', error);
    throw new functions.https.HttpsError('internal', '权限验证失败: ' + error.message);
  }

  const { phoneNumber, password, englishName, chineseName, identityTag, assignedCapital } = actualData;

  console.log('[createManager] Creating manager:', {
    phoneNumber,
    englishName,
    chineseName,
    identityTag,
    assignedCapital
  });

  // 验证必要栏位
  if (!phoneNumber || !password || !englishName || assignedCapital === undefined) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要栏位');
  }

  // 验证密码强度
  if (password.length < 8) {
    throw new functions.https.HttpsError('invalid-argument', '密码至少需要8个字符');
  }

  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new functions.https.HttpsError('invalid-argument', '密码必须包含英文字母和数字');
  }

  // 验证身份标签 (manager 必须有身份标签)
  const validIdentityTags = ['staff', 'teacher'];
  if (!identityTag || !validIdentityTags.includes(identityTag)) {
    throw new functions.https.HttpsError('invalid-argument', 'Manager 必须选择有效的身份标签 (staff 或 teacher)');
  }

  try {
    // 检查手机号码是否已存在
    const existingUserSnap = await getDb().collection('users')
      .where('basicInfo.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (!existingUserSnap.empty) {
      throw new functions.https.HttpsError('already-exists', '此手机号码已被使用');
    }

    // 验证分配额度是否超过可用额度
    const projectInfoRef = getDb().collection('system_config').doc('project_info');
    const projectInfoDoc = await projectInfoRef.get();
    const projectInfo = projectInfoDoc.data();
    const totalCapital = projectInfo.settings?.totalCapital || 0;

    const managersSnap = await getDb().collection('users')
      .where('roles', 'array-contains', 'manager')
      .get();

    let assignedSum = 0;
    managersSnap.forEach(doc => {
      const managerData = doc.data();
      assignedSum += managerData.roleSpecificData?.manager?.assignedCapital || 0;
    });

    if (assignedCapital + assignedSum > totalCapital) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `分配额度超过可用额度,可用: ${totalCapital - assignedSum}`
      );
    }

    // 生成 password hash 和 salt
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = sha256(password + passwordSalt);

    // 建立 Auth 用户
    const authUid = `phone_60${phoneNumber.replace(/^0/, "")}`;
    let userRecord;

    try {
      userRecord = await admin.auth().createUser({
        uid: authUid,
        displayName: englishName,
        disabled: false
      });
    } catch (authError) {
      if (authError.code === 'auth/uid-already-exists') {
        userRecord = await admin.auth().getUser(authUid);
      } else {
        throw authError;
      }
    }

    // 生成 Manager ID
    const managerIdNum = managersSnap.size + 1;
    const managerId = `M${managerIdNum.toString().padStart(3, '0')}`;

    // 构建 identityInfo
    let identityInfo = {};
    switch (identityTag) {
      case 'staff':
        identityInfo = {
          staffId: managerId,
          position: 'manager'
        };
        break;
      case 'teacher':
        identityInfo = {
          teacherId: managerId,
          department: '活动管理'
        };
        break;
    }

    // 建立 Firestore 文档 - 完全符合新架构
    const docId = `usr_${crypto.randomUUID()}`;
    await getDb().collection('users').doc(docId).set({
      userId: docId,
      authUid: userRecord.uid,
      roles: ['manager'],
      identityTag: identityTag,
      basicInfo: {
        phoneNumber: phoneNumber,
        englishName: englishName,
        chineseName: chineseName || '',

        // 登录密码
        passwordHash: passwordHash,
        passwordSalt: passwordSalt,
        hasDefaultPassword: true,        // ← 新增
        isFirstLogin: true,              // ← 新增
        passwordLastChanged: null,       // ← 新增

        // 交易密码（初始为空）
        transactionPinHash: null,        // ← 新增
        transactionPinSalt: null,        // ← 新增
        pinFailedAttempts: 0,            // ← 新增
        pinLockedUntil: null,            // ← 新增
        pinLastChanged: null,            // ← 新增

        isPhoneVerified: true
      },
      identityInfo: identityInfo,
      roleSpecificData: {
        manager: {
          managerId: managerId,
          assignedCapital: assignedCapital,
          allocatedToSellers: 0,
          availableCapital: assignedCapital,
          totalSellersManaged: 0,  // 动态计算,不存储数组
          performance: {
            totalPointsSoldBySellers: 0,
            totalRevenue: 0,
            utilizationRate: 0
          },
          allocationHistory: {
            totalAllocations: 0,
            lastAllocationAt: null,
            totalReclaimed: 0
          },
          capitalSource: {
            assignedBy: callerUid,
            assignedAt: new Date(),
            allocationId: null  // 后续创建分配记录时更新
          }
        }
      },
      activityData: {
        joinedAt: new Date(),
        lastActiveAt: new Date(),
        participationStatus: 'active'
      },
      accountStatus: {
        status: 'active',
        mustChangePassword: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      metadata: {
        registrationSource: 'admin_create',
        operatorUid: callerUid,
        createdBy: callerUid
      }
    });

    // 更新统计资料
    const newAssignedSum = assignedSum + assignedCapital;
    const newManagerCount = managersSnap.size + 1;

    await projectInfoRef.update({
      'statistics.totalManagers': newManagerCount,
      'statistics.assignedCapital': newAssignedSum,
      'statistics.availableCapital': totalCapital - newAssignedSum
    });

    console.log('[createManager] Manager created successfully:', docId);
    console.log('[createManager] Updated statistics:', {
      totalManagers: newManagerCount,
      assignedCapital: newAssignedSum,
      availableCapital: totalCapital - newAssignedSum
    });

    return {
      success: true,
      userId: docId,
      authUid: userRecord.uid,
      managerId: managerId,
      message: '管理员建立成功'
    };
  } catch (error) {
    console.error('[createManager] Error:', error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error.message || '建立管理员失败');
  }
});



exports.createUserByEventManagerHttp = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    // 只允许 POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      console.log('[createUserByEventManagerHttp] Request received');

      const {
        organizationId,
        eventId,
        phoneNumber,
        password,
        englishName,
        chineseName = '',
        email,
        identityTag = 'staff',
        department = '',
        identityId = '',
        roles = []
      } = req.body;

      // 验证必填字段（email 改为可选）
      if (!organizationId || !eventId || !phoneNumber || !password || !englishName) {
        res.status(400).json({ error: '缺少必填字段' });
        return;
      }

      // ✅ 新增：验证权限 - 确认调用者是 Event Manager
      const idToken = req.body.idToken || req.headers['authorization']?.replace('Bearer ', '') || null;
      if (!idToken) {
        res.status(401).json({ error: '需要登录 (缺少 idToken)' });
        return;
      }

      let callerUid = null;
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        callerUid = decodedToken.uid;
        console.log('[createUserByEventManagerHttp] Caller UID:', callerUid);
      } catch (err) {
        console.error('[createUserByEventManagerHttp] Token verification failed:', err);
        res.status(401).json({ error: '身份验证失败' });
        return;
      }

      // ✅ 检查调用者是否是 Event Manager
      const orgRef = getDb().collection('organizations').doc(organizationId);
      const hasPermission = await checkEventManagerPermission(callerUid, orgRef);

      if (!hasPermission) {
        console.log('[createUserByEventManagerHttp] Permission denied for UID:', callerUid);
        res.status(403).json({ error: '需要 Event Manager 权限' });
        return;
      }

      console.log('[createUserByEventManagerHttp] Permission granted for UID:', callerUid);

      // 验证至少有一个角色
      if (!roles || roles.length === 0) {
        res.status(400).json({ error: '至少需要选择一个角色' });
        return;
      }

      // 验证角色是否有效
      const validRoles = ['sellerManager', 'merchantManager', 'customerManager', 'cashier', 'seller', 'merchant', 'customer', 'pointSeller'];
      const invalidRoles = roles.filter(role => !validRoles.includes(role));
      if (invalidRoles.length > 0) {
        res.status(400).json({ error: `无效的角色: ${invalidRoles.join(', ')}` });
        return;
      }

      // 验证密码强度
      if (password.length < 8) {
        res.status(400).json({ error: '密码至少需要 8 个字符' });
        return;
      }

      if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
        res.status(400).json({ error: '密码必须包含英文字母和数字' });
        return;
      }

      // 1. 验证组织和活动是否存在
      const orgDoc = await getDb().collection('organizations').doc(organizationId).get();
      if (!orgDoc.exists) {
        res.status(404).json({ error: '组织不存在' });
        return;
      }

      // ✨ 验证身份标签（从 Organization 动态读取）
      const orgData = orgDoc.data();
      const identityTags = orgData.identityTags || [];
      const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
      if (!validTag) {
        res.status(400).json({
          error: `身份标签 "${identityTag}" 不存在或已停用，请在组织设置中检查可用的身份标签`
        });
        return;
      }

      // 2. 检查手机号是否已存在
      const eventsCol = getDb()
        .collection('organizations')
        .doc(organizationId)
        .collection('events');
      
      const usersCol = eventsCol
        .doc(eventId)
        .collection('users');

      const existingPhone = await usersCol
        .where('basicInfo.phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();

      if (!existingPhone.empty) {
        res.status(400).json({ error: '此手机号已在此活动中注册' });
        return;
      }

      // 3. 生成密码 hash
      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const passwordHash = sha256(password + passwordSalt);

      // 4. 创建 authUid
      const normalizedPhone = phoneNumber.replace(/^0/, '');
      const authUid = `phone_60${normalizedPhone}`;

      // 5. 创建或获取 Firebase Auth 用户
      try {
        await admin.auth().getUser(authUid);
        console.log('[createUserByEventManagerHttp] Auth user exists');
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          await admin.auth().createUser({
            uid: authUid,
            displayName: englishName,
            disabled: false
          });
          console.log('[createUserByEventManagerHttp] Auth user created');
        } else {
          throw error;
        }
      }

      // 6. 构建 identityInfo（通用方式，支持任意身份标签）
      // ✅ 使用前端传入的 identityId（学号/工号），如果没有则自动生成
      const identityName = (validTag && validTag.name && (validTag.name['zh-CN'] || validTag.name.zhCN || validTag.name.cn)) || identityTag;
      const identityNameEn = (validTag && validTag.name && (validTag.name['en'] || validTag.name.en || validTag.name['zh-CN'])) || identityTag;
      const identityInfo = {
        identityId: identityId && String(identityId).trim()
          ? String(identityId).trim()
          : `${identityTag.toUpperCase()}_${Date.now()}`,
        identityName: identityName,
        identityNameEn: identityNameEn,
        department: department || '未分配'
      };

      // 8. 创建用户文档
      // ✅ 统一格式：userId = authUid (phone_60xxx)
      const userId = authUid;
      const now = new Date();

      const userDoc = {
        userId: userId,
        authUid: authUid,
        roles: roles,
        identityTag: identityTag,
        basicInfo: {
          phoneNumber: phoneNumber,
          englishName: englishName,
          chineseName: chineseName || '',
          email: email,
          // 登录密码
          passwordHash: passwordHash,
          passwordSalt: passwordSalt,
          hasDefaultPassword: true,        // ← 新增
          isFirstLogin: true,              // ← 新增
          passwordLastChanged: null,       // ← 新增

          // 交易密码（初始为空）
          transactionPinHash: null,        // ← 新增
          transactionPinSalt: null,        // ← 新增
          pinFailedAttempts: 0,            // ← 新增
          pinLockedUntil: null,            // ← 新增
          pinLastChanged: null,            // ← 新增
          isPhoneVerified: true

        },
        identityInfo: identityInfo,
        activityData: {
          joinedAt: now,
          lastActiveAt: now,
          participationStatus: 'active'
        },
        accountStatus: {
          status: 'active',
          mustChangePassword: false,
          createdAt: now,
          updatedAt: now
        },
        metadata: {
          registrationSource: 'eventManager_create',
          operatorUid: 'eventManager',
          notes: `由 Event Manager 创建 - ${roles.join(', ')}`
        }
      };

      // ✅ 7.5. 添加角色特定的顶层字段（与 UserManagement.jsx 一致）
      if (roles.includes('sellerManager')) {
        userDoc.sellerManager = {
          managerId: `SM${Date.now()}`,
          assignedCapital: 0,
          availableCapital: 0,
          allocatedToSellers: 0,
          totalSellersManaged: 0,
          managedDepartments: []
        };
      }

      if (roles.includes('merchantManager')) {
        userDoc.merchantManager = {
          managerId: `MM${Date.now()}`,
          totalMerchantsManaged: 0
        };
      }

      if (roles.includes('customerManager')) {
        userDoc.customerManager = {
          managerId: `CM${Date.now()}`,
          totalCustomersManaged: 0,
          totalSalesAmount: 0
        };
      }

      if (roles.includes('seller')) {
        userDoc.seller = {
          sellerId: `SL${Date.now()}`,
          availablePoints: 0,
          currentSalesAmount: 0,
          totalPointsSold: 0,
          transactions: {}
        };
      }

      if (roles.includes('customer')) {
        userDoc.customer = {
          customerId: `CS${Date.now()}`,
          currentBalance: 0,
          totalPointsPurchased: 0,
          totalPointsConsumed: 0
        };
      }

      if (roles.includes('pointSeller')) {
        userDoc.pointSeller = {
          sellerId: `PS${Date.now()}`,
          totalCardsSold: 0,
          totalSalesAmount: 0,
          cashOnHand: 0
        };
      }

      // 8.5. 自动添加部门到组织（如果有department）
      if (department && department.trim()) {
        try {
          await addDepartmentIfNew(organizationId, department.trim(), 'system');
          console.log('[createUserByEventManagerHttp] Department processed:', department);
        } catch (err) {
          console.error('[createUserByEventManagerHttp] 添加部门失败:', err);
          // 不阻止用户创建，继续执行
        }
      }

      // 9. 保存用户文档
      await usersCol.doc(userId).set(userDoc);
      console.log('[createUserByEventManagerHttp] User created:', userId);

      // ✅ 修改：设置 Custom Claims（支持多事件）
      try {
        // 读取 event 文档获取 orgCode 和 eventCode
        const eventDoc = await eventsCol.doc(eventId).get();
        
        if (eventDoc.exists) {
          const eventData = eventDoc.data();
          const orgCode = eventData.orgCode;
          const eventCode = eventData.eventCode;
          
          if (orgCode && eventCode) {
            await updateUserCustomClaims(authUid, orgCode, eventCode, 'add');
            console.log('[createUserByEventManagerHttp] ✅ Custom Claims 设置成功:', authUid);
          } else {
            console.warn('[createUserByEventManagerHttp] ⚠️ Event 文档缺少 orgCode 或 eventCode');
          }
        } else {
          console.warn('[createUserByEventManagerHttp] ⚠️ Event 文档不存在');
        }
      } catch (e) {
        console.error('[createUserByEventManagerHttp] ⚠️ Custom Claims 设置失败（非致命）:', e.message);
        // 不阻止用户创建
      }



      // 10. 更新活动统计
      const updateData = {
        'statistics.totalUsers': admin.firestore.FieldValue.increment(1),
        updatedAt: now
      };

      // 根据角色更新对应的统计
      if (roles.includes('sellerManager')) {
        updateData['statistics.totalSellerManagers'] = admin.firestore.FieldValue.increment(1);
      }
      if (roles.includes('merchantManager')) {
        updateData['statistics.totalMerchantManagers'] = admin.firestore.FieldValue.increment(1);
      }
      if (roles.includes('customerManager')) {
        updateData['statistics.totalCustomerManagers'] = admin.firestore.FieldValue.increment(1);
      }
      if (roles.includes('seller')) {
        updateData['statistics.totalSellers'] = admin.firestore.FieldValue.increment(1);
      }
      if (roles.includes('customer')) {
        updateData['statistics.totalCustomers'] = admin.firestore.FieldValue.increment(1);
      }
      if (roles.includes('pointSeller')) {
        updateData['statistics.totalPointSellers'] = admin.firestore.FieldValue.increment(1);
      }

      await getDb()
        .collection('organizations')
        .doc(organizationId)
        .collection('events')
        .doc(eventId)
        .set(updateData, { merge: true });

      console.log('[createUserByEventManagerHttp] Success');

      // 返回成功结果
      res.status(200).json({
        success: true,
        userId: userId,
        authUid: authUid,
        roles: roles,
        message: '用户创建成功'
      });

    } catch (error) {
      console.error('[createUserByEventManagerHttp] Error:', error);
      res.status(500).json({
        error: error.message || '创建用户失败'
      });
    }
  });
});

/**
 * HTTP function to delete an event and all related data
 * - Auth: requires caller to be a platform admin
 * - Data required: organizationId, eventId
 * - Behavior: 
 *   1. Deletes all users in the event
 *   2. Deletes all metadata
 *   3. Deletes the event document
 *   4. Removes Event Manager from organization's admins array
 *   5. Updates organization statistics
 */
exports.deleteEventHttp = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST requests are allowed' });
      return;
    }

    try {
      const { organizationId, eventId, idToken } = req.body;

      if (!organizationId || !eventId || !idToken) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      console.log('[deleteEventHttp] Starting deletion:', { organizationId, eventId });

      // Validate required fields
      if (!organizationId || !eventId || !idToken) {
        res.status(400).json({
          error: '缺少必需参数：organizationId, eventId, idToken'
        });
        return;
      }

      console.log('[deleteEventHttp] Starting deletion:', { organizationId, eventId });

      // Verify the ID token and check if user is platform admin
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        console.error('[deleteEventHttp] Token verification failed:', error);
        res.status(401).json({ error: '身份验证失败' });
        return;
      }

      const callerUid = decodedToken.uid;

      // Check if caller is platform admin
      const adminCheck = await getDb().collection('admin_uids').doc(callerUid).get();
      if (!adminCheck.exists) {
        res.status(403).json({ error: '只有平台管理员可以删除活动' });
        return;
      }

      const db = getDb();
      const eventRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId);

      // Get event data before deletion
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) {
        res.status(404).json({ error: '活动不存在' });
        return;
      }

      const eventData = eventSnap.data();
      const usersToDelete = eventData.statistics?.totalUsers || 0;
      const isActive = eventData.status === 'active';

      console.log('[deleteEventHttp] Event data:', {
        usersToDelete,
        isActive,
        eventManager: eventData.eventManager
      });

      // Get organization data (for admins array)
      const orgRef = db.collection('organizations').doc(organizationId);
      const orgSnap = await orgRef.get();

      if (!orgSnap.exists) {
        res.status(404).json({ error: '组织不存在' });
        return;
      }

      const currentAdmins = orgSnap.data()?.admins || [];

      // 先聚合本活動中各部門使用人數，刪除後要回沖（減少） organization.departments 的 userCount，避免累積過多
      const departmentUsageCounter = new Map(); // key: normalized lower-case name, value: { name, count }
      const usersForDeptScan = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users')
        .get();
      usersForDeptScan.forEach(doc => {
        const deptName = doc.data()?.identityInfo?.department;
        if (typeof deptName === 'string' && deptName.trim()) {
          const display = deptName.trim();
          const key = display.toLocaleLowerCase();
          const prev = departmentUsageCounter.get(key) || { name: display, count: 0 };
          prev.count += 1;
          departmentUsageCounter.set(key, prev);
        }
      });

      // Use batch for atomic operations (max 500 operations per batch)
      const batch = db.batch();
      let operationCount = 0;

      // 1. Delete all users and their pointAllocations subcollections
      const usersSnapshot = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users')
        .get();

      console.log(`[deleteEventHttp] Found ${usersSnapshot.size} users to delete`);

      usersSnapshot.docs.forEach(userDoc => {
        // 删除用户文档本身
        batch.delete(userDoc.ref);
        operationCount++;

        // 删除用户下的 pointAllocations 子集合
        // 注意：Firestore 不支持在 batch 中直接删除整个子集合
        // 但我们可以在此处同步获取并删除（因为通常不会很多）
        // 这里暂时标记，后续使用事务或单独处理
      });

      // 2. Delete all metadata
      const metadataSnapshot = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('metadata')
        .get();

      console.log(`[deleteEventHttp] Found ${metadataSnapshot.size} metadata documents to delete`);

      metadataSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        operationCount++;
      });

      // 3. Delete the event document itself
      batch.delete(eventRef);
      operationCount++;

      // 4. Filter out Event Manager from admins array
      const updatedAdmins = currentAdmins.filter(admin => admin.eventId !== eventId);
      const removedAdminsCount = currentAdmins.length - updatedAdmins.length;

      console.log(`[deleteEventHttp] Removing ${removedAdminsCount} Event Manager(s) from admins array`);

      // 5. Update organization admins（統計將在後續交易中以 clamp 方式更新，避免負數）
      batch.update(orgRef, {
        'admins': updatedAdmins,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      operationCount++;

      console.log(`[deleteEventHttp] Committing batch with ${operationCount} operations`);

      // Commit all operations atomically
      await batch.commit();

      // 6. Delete pointAllocations subcollections for all users
      // (这必须在 batch 之后进行，因为 Firestore 不支持在 batch 中删除子集合)
      console.log('[deleteEventHttp] Starting deletion of pointAllocations subcollections');

      const deletePointAllocationsPromises = usersSnapshot.docs.map(async (userDoc) => {
        try {
          const pointAllocationsSnapshot = await userDoc.ref
            .collection('pointAllocations')
            .get();

          if (pointAllocationsSnapshot.size > 0) {
            const pointBatch = db.batch();
            let pointBatchOps = 0;

            pointAllocationsSnapshot.docs.forEach(allocDoc => {
              pointBatch.delete(allocDoc.ref);
              pointBatchOps++;
            });

            await pointBatch.commit();
            console.log(`[deleteEventHttp] Deleted ${pointBatchOps} pointAllocations for user ${userDoc.id}`);
          }
        } catch (err) {
          console.error(`[deleteEventHttp] Error deleting pointAllocations for user ${userDoc.id}:`, err);
        }
      });

      await Promise.all(deletePointAllocationsPromises);
      console.log('[deleteEventHttp] ✅ All pointAllocations deleted');

      // 7. Delete departmentStats subcollection (新增)
      console.log('[deleteEventHttp] Starting deletion of departmentStats');
      try {
        const departmentStatsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('departmentStats')
          .get();

        if (departmentStatsSnapshot.size > 0) {
          const deptBatch = db.batch();
          let deptBatchOps = 0;

          departmentStatsSnapshot.docs.forEach(doc => {
            deptBatch.delete(doc.ref);
            deptBatchOps++;
          });

          await deptBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${deptBatchOps} departmentStats documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting departmentStats:', err);
      }

      // 8. Delete sellerManagerStats subcollection (新增)
      console.log('[deleteEventHttp] Starting deletion of sellerManagerStats');
      try {
        const sellerManagerStatsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('sellerManagerStats')
          .get();

        if (sellerManagerStatsSnapshot.size > 0) {
          const smBatch = db.batch();
          let smBatchOps = 0;

          sellerManagerStatsSnapshot.docs.forEach(doc => {
            smBatch.delete(doc.ref);
            smBatchOps++;
          });

          await smBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${smBatchOps} sellerManagerStats documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting sellerManagerStats:', err);
      }

      // 9. Delete cashCollections subcollection (新增)
      console.log('[deleteEventHttp] Starting deletion of cashCollections');
      try {
        const cashCollectionsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('cashCollections')
          .get();

        if (cashCollectionsSnapshot.size > 0) {
          const ccBatch = db.batch();
          let ccBatchOps = 0;

          cashCollectionsSnapshot.docs.forEach(doc => {
            ccBatch.delete(doc.ref);
            ccBatchOps++;
          });

          await ccBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${ccBatchOps} cashCollections documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting cashCollections:', err);
      }

      // 10. Delete cashSubmissions subcollection (新增)
      console.log('[deleteEventHttp] Starting deletion of cashSubmissions');
      try {
        const cashSubmissionsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('cashSubmissions')
          .get();

        if (cashSubmissionsSnapshot.size > 0) {
          const csaBatch = db.batch();
          let csaBatchOps = 0;

          cashSubmissionsSnapshot.docs.forEach(doc => {
            csaBatch.delete(doc.ref);
            csaBatchOps++;
          });

          await csaBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${csaBatchOps} cashSubmissions documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting cashSubmissions:', err);
      }

      // 11. Delete merchants subcollection (新增)
      console.log('[deleteEventHttp] Starting deletion of merchants');
      try {
        const merchantsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('merchants')
          .get();

        if (merchantsSnapshot.size > 0) {
          // 对每个 merchant，删除其 transactions 子集合
          const deleteMerchantsPromises = merchantsSnapshot.docs.map(async (merchantDoc) => {
            try {
              const transactionsSnapshot = await merchantDoc.ref
                .collection('transactions')
                .get();

              if (transactionsSnapshot.size > 0) {
                const txBatch = db.batch();
                let txBatchOps = 0;

                transactionsSnapshot.docs.forEach(txDoc => {
                  txBatch.delete(txDoc.ref);
                  txBatchOps++;
                });

                await txBatch.commit();
                console.log(`[deleteEventHttp] Deleted ${txBatchOps} transactions for merchant ${merchantDoc.id}`);
              }
            } catch (err) {
              console.error(`[deleteEventHttp] Error deleting transactions for merchant ${merchantDoc.id}:`, err);
            }
          });

          await Promise.all(deleteMerchantsPromises);

          // 删除 merchants 文档本身
          const merchantBatch = db.batch();
          merchantsSnapshot.docs.forEach(doc => {
            merchantBatch.delete(doc.ref);
          });
          await merchantBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${merchantsSnapshot.size} merchants documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting merchants:', err);
      }

      // 12. Delete transactions subcollection (如果直接在 event 下也有) (新增)
      console.log('[deleteEventHttp] Starting deletion of transactions');
      try {
        const transactionsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('transactions')
          .get();

        if (transactionsSnapshot.size > 0) {
          const txBatch = db.batch();
          let txBatchOps = 0;

          transactionsSnapshot.docs.forEach(doc => {
            txBatch.delete(doc.ref);
            txBatchOps++;
          });

          await txBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${txBatchOps} transactions documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting transactions:', err);
      }

      // 13. Delete pointCards subcollection (新增)
      console.log('[deleteEventHttp] Starting deletion of pointCards');
      try {
        const pointCardsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('pointCards')
          .get();

        if (pointCardsSnapshot.size > 0) {
          const pcBatch = db.batch();
          let pcOps = 0;

          pointCardsSnapshot.docs.forEach(doc => {
            pcBatch.delete(doc.ref);
            pcOps++;
          });

          await pcBatch.commit();
          console.log(`[deleteEventHttp] Deleted ${pcOps} pointCards documents`);
        }
      } catch (err) {
        console.error('[deleteEventHttp] Error deleting pointCards:', err);
      }

      // 進行 department userCount 回沖（減少） - 使用 transaction 保證一致性
      try {
        await db.runTransaction(async (tx) => {
          const orgDoc = await tx.get(orgRef);
          if (!orgDoc.exists) return; // 組織不存在則略過
          const orgData = orgDoc.data() || {};
          const departments = Array.isArray(orgData.departments) ? orgData.departments : [];
          const next = departments.map(d => {
            if (!d || typeof d.name !== 'string') return d;
            const key = d.name.trim().toLocaleLowerCase();
            const usage = departmentUsageCounter.get(key);
            if (!usage) return d;
            const current = d.userCount || 0;
            const decremented = current - usage.count;
            return { ...d, userCount: decremented >= 0 ? decremented : 0 }; // 不允許負數
          });
          tx.update(orgRef, {
            departments: next,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        console.log('[deleteEventHttp] Department userCounts decremented:', Array.from(departmentUsageCounter.values()));
      } catch (deptErr) {
        console.error('[deleteEventHttp] Department decrement transaction error:', deptErr && deptErr.message);
        // 不影響主流程，僅記錄錯誤
      }

      // 使用交易對組織統計做 clamp，避免負數
      try {
        await db.runTransaction(async (tx) => {
          const orgDoc = await tx.get(orgRef);
          if (!orgDoc.exists) return;
          const data = orgDoc.data() || {};
          const stats = data.statistics || {};
          const totalUsers = Math.max(0, (stats.totalUsers || 0) - usersToDelete);
          const totalEvents = Math.max(0, (stats.totalEvents || 0) - 1);
          const activeEvents = Math.max(0, (stats.activeEvents || 0) - (isActive ? 1 : 0));
          tx.update(orgRef, {
            'statistics.totalUsers': totalUsers,
            'statistics.totalEvents': totalEvents,
            'statistics.activeEvents': activeEvents,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        console.log('[deleteEventHttp] Organization statistics clamped to non-negative');
      } catch (clampErr) {
        console.error('[deleteEventHttp] Clamp stats transaction error:', clampErr && clampErr.message);
      }

      // 最後做一次全組織層面的部門人數重算（保險），並可選擇清理 userCount=0 且為 system 建立的部門
      // ✅ 最後做一次全組織層面的部門人數重算（保險）
      // ✅ 但保留所有部門，即使 userCount=0（由管理員手動刪除不需要的部門）
      try {
        console.log('[deleteEventHttp] 開始重算組織的部門人數');

        const remainingEvents = await orgRef.collection('events').get();
        const allDeptUsage = new Map(); // key: lower-case name, value: count

        // 遍歷所有剩餘的 Events，統計部門使用
        for (const evDoc of remainingEvents.docs) {
          const usersSnap = await evDoc.ref.collection('users').get();
          usersSnap.forEach(userDoc => {
            const dept = userDoc.data()?.identityInfo?.department;
            if (typeof dept === 'string' && dept.trim()) {
              const key = dept.trim().toLowerCase();
              allDeptUsage.set(key, (allDeptUsage.get(key) || 0) + 1);
            }
          });
        }

        // 更新組織的部門統計
        await db.runTransaction(async (tx) => {
          const orgDoc = await tx.get(orgRef);
          if (!orgDoc.exists) return;

          const orgData = orgDoc.data() || {};
          const departments = Array.isArray(orgData.departments) ? orgData.departments : [];

          // ✅ 更新每個部門的 userCount，但不刪除任何部門
          const updatedDepartments = departments.map(d => {
            if (!d || typeof d.name !== 'string') return d;
            const key = d.name.trim().toLowerCase();
            const count = allDeptUsage.get(key) || 0;
            return { ...d, userCount: count };
          });

          tx.update(orgRef, {
            departments: updatedDepartments,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        console.log('[deleteEventHttp] 部門人數重算完成，保留所有部門');
      } catch (deptErr) {
        console.error('[deleteEventHttp] 部門重算錯誤:', deptErr && deptErr.message);
        // 不影響主流程，僅記錄錯誤
      }

      console.log('[deleteEventHttp] ✅ Delete successful');

      res.status(200).json({
        success: true,
        deletedUsers: usersSnapshot.size,
        deletedMetadata: metadataSnapshot.size,
        removedAdmins: removedAdminsCount,
        departmentsAdjusted: Array.from(departmentUsageCounter.values()),
        updatedStatistics: {
          totalUsers: -usersToDelete,
          totalEvents: -1,
          activeEvents: isActive ? -1 : 0
        },
        message: '活动删除成功'
      });

    } catch (error) {
      console.error('[deleteEventHttp] Error:', error);
      res.status(500).json({
        error: error.message || '删除活动失败'
      });
    }
  });
});

/**
 * HTTP function to check for duplicate users before batch import
 * - Input: organizationId, eventId, phoneNumbers (array of phone numbers)
 * - Output: { duplicates: [phone1, phone2, ...], message }
 */
exports.checkDuplicateUsers = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST requests are allowed' });
      return;
    }

    try {
      const { organizationId, eventId, phoneNumbers } = req.body;

      // Validate required fields
      if (!organizationId || !eventId || !Array.isArray(phoneNumbers)) {
        res.status(400).json({
          error: '缺少必需参数：organizationId, eventId, phoneNumbers'
        });
        return;
      }

      console.log(`[checkDuplicateUsers] Checking ${phoneNumbers.length} phone numbers for event ${eventId}`);

      const db = getDb();
      const usersRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users');

      // Get all users in the event
      const usersSnapshot = await usersRef.get();
      const existingPhones = new Set();

      usersSnapshot.docs.forEach(doc => {
        const phone = doc.data().basicInfo?.phoneNumber;
        if (phone) {
          existingPhones.add(phone);
        }
      });

      // Check for duplicates
      const duplicates = phoneNumbers.filter(phone => existingPhones.has(phone));

      console.log(`[checkDuplicateUsers] Found ${duplicates.length} duplicates`);
      console.log(`[checkDuplicateUsers] Existing phones: ${Array.from(existingPhones).join(', ')}`);

      res.status(200).json({
        duplicates: duplicates,
        existingCount: existingPhones.size,
        importCount: phoneNumbers.length,
        hasDuplicates: duplicates.length > 0,
        message: duplicates.length > 0
          ? `发现 ${duplicates.length} 个重复电话号码`
          : '没有找到重复'
      });

    } catch (error) {
      console.error('[checkDuplicateUsers] Error:', error);
      res.status(500).json({
        error: error.message || '检查重复失败'
      });
    }
  });
});
/**
 * Helper function: Add department to organization if it doesn't exist
 * Called internally by addUser and batchImportUsers
 */
async function addDepartmentIfNew(orgId, departmentName, createdBy = 'system') {
  // 使用交易確保並發導入時 userCount 不會遺失更新，且避免重複部門被同時建立
  if (!departmentName || typeof departmentName !== 'string' || !departmentName.trim()) return;

  const db = getDb();
  const orgRef = db.collection('organizations').doc(orgId);

  const normalizedName = departmentName.trim();
  const compareKey = normalizedName.toLocaleLowerCase();

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orgRef);
      if (!snap.exists) return; // 組織不存在則跳過

      const data = snap.data() || {};
      const departments = Array.isArray(data.departments) ? data.departments : [];

      // 尋找是否存在（以名稱大小寫不敏感 + trim 比對）
      const idx = departments.findIndex(
        (d) => d && typeof d.name === 'string' && d.name.trim().toLocaleLowerCase() === compareKey
      );

      if (idx === -1) {
        // 新增部門，第一位使用者計數 = 1
        const newDept = {
          id: `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: normalizedName,
          displayOrder: departments.length + 1,
          userCount: 1,
          createdAt: admin.firestore.Timestamp.fromDate(new Date()),
          createdBy: createdBy
        };
        const nextDepts = [...departments, newDept];
        tx.update(orgRef, {
          departments: nextDepts,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[addDepartmentIfNew][tx] Added: ${normalizedName}`);
      } else {
        // 遞增既有部門人數
        const target = departments[idx] || {};
        const nextDepts = departments.slice();
        nextDepts[idx] = { ...target, userCount: (target.userCount || 0) + 1 };
        tx.update(orgRef, {
          departments: nextDepts,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[addDepartmentIfNew][tx] Incremented: ${normalizedName}`);
      }
    });
  } catch (e) {
    console.error('[addDepartmentIfNew] Transaction error:', e && e.message);
  }
}

/**
 * HTTP function: Add a new department manually
 * Auth: requires eventManager role
 * Data: organizationId, departmentName, idToken
 */
exports.addDepartment = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST requests are allowed' });
      return;
    }

    try {
      console.log('[addDepartment] headers:', JSON.stringify(req.headers || {}));
      const rawBodyForLog = typeof req.body === 'string' ? req.body : (req.body ? JSON.stringify(req.body) : 'undefined');
      console.log('[addDepartment] raw body:', rawBodyForLog);
      // 支援兩種攜帶 token 的方式：Authorization: Bearer <token> 或 body.idToken
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring('Bearer '.length)
        : null;

      // 對於 body 可能為字串（rewrite/代理情境），做健壯解析
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, departmentName } = body;
      const idToken = body.idToken || tokenFromHeader;

      if (!organizationId || !departmentName || !idToken) {
        res.status(400).json({ error: '缺少必需参数' });
        return;
      }

      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        console.error('[addDepartment] verifyIdToken error:', error && error.message);
        res.status(401).json({ error: '身份验证失败' });
        return;
      }

      const callerUid = decodedToken.uid;
      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventsSnapshot = await orgRef.collection('events').get();

      // ✅ 使用通用权限检查函数
      const hasPermission = await checkEventManagerPermission(callerUid, orgRef);

      if (!hasPermission) {
        res.status(403).json({ error: '需要 Event Manager 权限' });
        return;
      }

      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        res.status(404).json({ error: '组织不存在' });
        return;
      }

      const orgData = orgSnap.data() || {};
      const departments = Array.isArray(orgData.departments) ? orgData.departments : [];
      const normalizedName = departmentName.trim();
      const compareKey = normalizedName.toLocaleLowerCase();

      if (departments.some(d => d && typeof d.name === 'string' && d.name.trim().toLocaleLowerCase() === compareKey)) {
        res.status(400).json({ error: '部门名称已存在' });
        return;
      }

      const newDept = {
        id: `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: normalizedName,
        displayOrder: departments.length + 1,
        userCount: 0,
        createdAt: admin.firestore.Timestamp.fromDate(new Date()),
        createdBy: callerUid
      };

      try {
        await orgRef.update({
          departments: admin.firestore.FieldValue.arrayUnion(newDept),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error('[addDepartment] Firestore update error (arrayUnion):', e && e.message);
        throw e; // 繼續往外層 catch 讓 HTTP 500 回傳
      }

      res.status(200).json({
        success: true,
        department: newDept,
        message: '部门添加成功'
      });

    } catch (error) {
      console.error('[addDepartment] Error:', error);
      res.status(500).json({ error: error && error.message ? error.message : '添加部门失败' });
    }
  });
});

/**
 * HTTP function: Delete a department
 */
exports.deleteDepartment = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST requests are allowed' });
      return;
    }

    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring('Bearer '.length)
        : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, departmentId } = body;
      const idToken = body.idToken || tokenFromHeader;

      if (!organizationId || !departmentId || !idToken) {
        res.status(400).json({ error: '缺少必需参数' });
        return;
      }

      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        res.status(401).json({ error: '身份验证失败' });
        return;
      }

      const callerUid = decodedToken.uid;
      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventsSnapshot = await orgRef.collection('events').get();

      // ✅ 使用通用权限检查函数
      const hasPermission = await checkEventManagerPermission(callerUid, orgRef);

      if (!hasPermission) {
        res.status(403).json({ error: '需要 Event Manager 权限' });
        return;
      }

      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        res.status(404).json({ error: '组织不存在' });
        return;
      }

      const orgData = orgSnap.data() || {};
      const departments = Array.isArray(orgData.departments) ? orgData.departments : [];
      const deptToDelete = departments.find(d => d.id === departmentId);

      if (!deptToDelete) {
        res.status(404).json({ error: '部门不存在' });
        return;
      }

      // Clear department from users
      let clearedUsersCount = 0;
      for (const eventDoc of eventsSnapshot.docs) {
        const usersSnapshot = await eventDoc.ref.collection('users')
          .where('identityInfo.department', '==', deptToDelete.name)
          .get();

        if (!usersSnapshot.empty) {
          const batch = db.batch();
          usersSnapshot.docs.forEach(userDoc => {
            batch.update(userDoc.ref, {
              'identityInfo.department': admin.firestore.FieldValue.delete()
            });
          });
          await batch.commit();
          clearedUsersCount += usersSnapshot.size;
        }
      }

      const updatedDepts = departments.filter(d => d.id !== departmentId);
      await orgRef.update({
        departments: updatedDepts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.status(200).json({
        success: true,
        clearedUsers: clearedUsersCount,
        message: `部门删除成功${clearedUsersCount > 0 ? `，已清除 ${clearedUsersCount} 位用户的部门信息` : ''}`
      });

    } catch (error) {
      console.error('[deleteDepartment] Error:', error);
      res.status(500).json({ error: error.message || '删除部门失败' });
    }
  });
});

/**
 * HTTP function: Update department display order
 */
exports.reorderDepartments = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Only POST requests are allowed' });
      return;
    }

    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring('Bearer '.length)
        : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, reorderedDepartments } = body;
      const idToken = body.idToken || tokenFromHeader;

      if (!organizationId || !Array.isArray(reorderedDepartments) || !idToken) {
        res.status(400).json({ error: '缺少必需参数' });
        return;
      }

      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        res.status(401).json({ error: '身份验证失败' });
        return;
      }

      const callerUid = decodedToken.uid;
      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventsSnapshot = await orgRef.collection('events').get();

      // ✅ 使用通用权限检查函数
      const hasPermission = await checkEventManagerPermission(callerUid, orgRef);

      if (!hasPermission) {
        res.status(403).json({ error: '需要 Event Manager 权限' });
        return;
      }

      // 排序更新時也做名稱 trim（保留原大小寫顯示，但消除意外的前後空白差異）
      const cleaned = reorderedDepartments.map(d => ({
        ...d,
        name: typeof d.name === 'string' ? d.name.trim() : d.name
      }));
      await orgRef.update({
        departments: cleaned,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.status(200).json({
        success: true,
        message: '部门顺序更新成功'
      });

    } catch (error) {
      console.error('[reorderDepartments] Error:', error);
      res.status(500).json({ error: error.message || '更新部门顺序失败' });
    }
  });
});

exports.addDepartmentIfNew = addDepartmentIfNew;

// ========== 單一入口：部門管理（CRUD + 排序 + 查詢） ==========
// POST /api/departments  { action: 'add'|'delete'|'reorder'|'list', ... }
// 可接受 Authorization: Bearer <idToken> 或 body.idToken
exports.departmentsHttp = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring('Bearer '.length)
        : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const action = (body.action || (req.method === 'GET' ? 'list' : '')).toString();
      const organizationId = body.organizationId || req.query.organizationId;
      const idToken = body.idToken || tokenFromHeader;

      if (!organizationId) {
        return res.status(400).json({ error: '缺少组织编号' });
      }

      // list 動作允許未登入（僅讀取組織文件），其餘需要 Event Manager 權限
      let callerUid = null;
      if (action !== 'list') {
        if (!idToken) return res.status(401).json({ error: '需要登录' });
        try {
          const decoded = await admin.auth().verifyIdToken(idToken);
          callerUid = decoded.uid;
        } catch (e) {
          return res.status(401).json({ error: '身份验证失败' });
        }
      }

      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) return res.status(404).json({ error: '组织不存在' });

      // ============================================
      // admin.js - departmentsHttp 函数修复
      // 位置：第 2295-2310 行
      // ============================================

      // ✅ 新的 ensurePermission 函数（替换旧版本）
      const ensurePermission = async () => {
        if (!callerUid) return false;

        // 標準化電話號碼
        const normalizePhone = (p) => {
          if (!p) return '';
          let digits = String(p).replace(/[^0-9]/g, '');
          if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2);
          if (digits.startsWith('0')) digits = digits.substring(1);
          return digits;
        };

        // 從 callerUid 解析電話號碼（支持多種格式）
        let phoneFromUid = null;
        if (callerUid.includes('_')) {
          const parts = callerUid.split('_');
          // 格式: role_phone (例如: eventManager_0181234567 或 sellerManager_60181234567)
          phoneFromUid = parts.slice(1).join('_'); // 取 _ 之後的所有內容
        }

        if (!phoneFromUid) {
          console.log('[departmentsHttp] 無法從 UID 解析電話號碼:', callerUid);
          return false;
        }

        const coreCaller = normalizePhone(phoneFromUid);
        console.log('[departmentsHttp] 檢查權限，電話號碼:', coreCaller);

        // ✅ 檢查所有活動的 Event Manager 和 admins
        const eventsSnapshot = await orgRef.collection('events').get();
        for (const eventDoc of eventsSnapshot.docs) {
          const eventData = eventDoc.data();

          // ✅ 檢查 1：Event Manager (新架構)
          const eventManager = eventData.eventManager;
          if (eventManager) {
            // 1a. authUid 完全匹配（首選）
            if (eventManager.authUid && eventManager.authUid === callerUid) {
              console.log('[departmentsHttp] 權限通過：Event Manager (authUid 完全匹配)');
              return true;
            }
            // 1b. 以電話號碼匹配（容忍不同 UID 前綴與 E.164/本地格式差異）
            const emPhone = eventManager.phoneNumber || eventManager.phone;
            if (emPhone) {
              const coreEm = normalizePhone(emPhone);
              if (coreEm && coreEm === coreCaller) {
                console.log('[departmentsHttp] 權限通過：Event Manager (電話號碼匹配)');
                return true;
              }
            }
          }

          // ✅ 檢查 2：檢查 admins 敡列（舊架構相容）
          const admins = Array.isArray(eventData.admins) ? eventData.admins : [];

          for (const admin of admins) {
            const adminPhone = admin.phone || admin.phoneNumber;
            if (!adminPhone) continue;

            const coreAdmin = normalizePhone(adminPhone);
            if (coreCaller === coreAdmin) {
              console.log('[departmentsHttp] 權限通過：事件 admins 敡列匹配 (電話號碼)');
              return true;
            }
          }
        }

        console.log('[departmentsHttp] 權限拒絕，UID:', callerUid, '解析的電話:', coreCaller);
        return false;
      };

      const getDepartments = () => {
        const data = orgSnap.data() || {};
        return Array.isArray(data.departments) ? data.departments : [];
      };

      switch (action) {
        case 'list': {
          return res.status(200).json({ success: true, departments: getDepartments() });
        }
        case 'recount': {
          // 重新統計所有 events 之使用者的部門人數，修復因並發或歷史資料造成的 userCount 不一致
          if (!(await ensurePermission())) return res.status(403).json({ error: '需要 Event Manager 权限' });
          const { eventId } = body;
          const eventsSnapshot = eventId
            ? { docs: [await orgRef.collection('events').doc(eventId).get()] }
            : await orgRef.collection('events').get();
          const counter = new Map(); // key: normalized name, value: { displayName, count }
          for (const ev of eventsSnapshot.docs) {
            if (!ev || (ev.exists !== undefined && !ev.exists)) continue;
            const evRef = ev.ref || orgRef.collection('events').doc(ev.id);
            const usersSnapshot = await evRef.collection('users').get();
            usersSnapshot.forEach((u) => {
              const name = u.data()?.identityInfo?.department;
              if (typeof name === 'string' && name.trim()) {
                const display = name.trim();
                const key = display.toLocaleLowerCase();
                const stat = counter.get(key) || { displayName: display, count: 0 };
                stat.count += 1;
                // 若不同大小寫以準確度高的為準
                if (!counter.has(key)) counter.set(key, stat); else counter.set(key, stat);
              }
            });
          }

          // 合併到現有清單：更新既有部門的 userCount；若使用者資料含有新部門但清單中沒有，則自動補上
          const existing = getDepartments();
          const existingByKey = new Map(existing.map(d => [
            (d && typeof d.name === 'string' ? d.name.trim().toLocaleLowerCase() : ''), d
          ]));

          const merged = [];
          let order = 1;
          existing.forEach((d) => {
            if (!d || typeof d.name !== 'string') return;
            const key = d.name.trim().toLocaleLowerCase();
            const cnt = counter.get(key)?.count || 0;
            merged.push({ ...d, userCount: cnt, displayOrder: order++ });
          });

          // 加入新部門（存在於 counter 但不存在於清單）
          counter.forEach((stat, key) => {
            if (!existingByKey.has(key)) {
              merged.push({
                id: `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: stat.displayName,
                displayOrder: order++,
                userCount: stat.count,
                createdAt: admin.firestore.Timestamp.fromDate(new Date()),
                createdBy: 'system'
              });
            }
          });

          await orgRef.update({ departments: merged, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          return res.status(200).json({ success: true, departments: merged, message: '部门人数已重新统计' });
        }
        case 'add': {
          if (!(await ensurePermission())) return res.status(403).json({ error: '需要 Event Manager 权限' });
          const { departmentName } = body;
          if (!departmentName || !departmentName.trim()) return res.status(400).json({ error: '缺少部门名称' });
          const departments = getDepartments();
          const name = departmentName.trim();
          const key = name.toLocaleLowerCase();
          if (departments.some(d => d && typeof d.name === 'string' && d.name.trim().toLocaleLowerCase() === key)) {
            return res.status(400).json({ error: '部门名称已存在' });
          }
          const newDept = {
            id: `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            displayOrder: departments.length + 1,
            userCount: 0,
            createdAt: admin.firestore.Timestamp.fromDate(new Date()),
            createdBy: callerUid
          };
          await orgRef.update({
            departments: admin.firestore.FieldValue.arrayUnion(newDept),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return res.status(200).json({ success: true, department: newDept, message: '部门添加成功' });
        }
        case 'delete': {
          if (!(await ensurePermission())) return res.status(403).json({ error: '需要 Event Manager 权限' });
          const { departmentId } = body;
          if (!departmentId) return res.status(400).json({ error: '缺少部门编号' });
          const departments = getDepartments();
          const target = departments.find(d => d.id === departmentId);
          if (!target) return res.status(404).json({ error: '部门不存在' });
          // 清理所有 event 下使用此部門的使用者欄位
          const eventsSnapshot = await orgRef.collection('events').get();
          let clearedUsersCount = 0;
          for (const eventDoc of eventsSnapshot.docs) {
            const usersSnapshot = await eventDoc.ref.collection('users')
              .where('identityInfo.department', '==', target.name)
              .get();
            if (!usersSnapshot.empty) {
              const batch = db.batch();
              usersSnapshot.docs.forEach(userDoc => batch.update(userDoc.ref, { 'identityInfo.department': admin.firestore.FieldValue.delete() }));
              await batch.commit();
              clearedUsersCount += usersSnapshot.size;
            }
          }
          const updatedDepts = departments.filter(d => d.id !== departmentId);
          await orgRef.update({ departments: updatedDepts, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          return res.status(200).json({ success: true, clearedUsers: clearedUsersCount, message: '部门删除成功' });
        }
        case 'reorder': {
          if (!(await ensurePermission())) return res.status(403).json({ error: '需要 Event Manager 权限' });
          const { reorderedDepartments } = body;
          if (!Array.isArray(reorderedDepartments)) return res.status(400).json({ error: '缺少排序数据' });
          const cleaned = reorderedDepartments.map((d, idx) => ({
            ...d,
            name: typeof d.name === 'string' ? d.name.trim() : d.name,
            displayOrder: idx + 1
          }));
          await orgRef.update({ departments: cleaned, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          return res.status(200).json({ success: true, message: '部门顺序更新成功' });
        }
        default:
          return res.status(400).json({ error: '未知的 action' });
      }
    } catch (error) {
      console.error('[departmentsHttp] Error:', error);
      return res.status(500).json({ error: error && error.message ? error.message : '内部错误' });
    }
  });
});

// ========== 批量匯入使用者（Event Manager） ==========
// POST /api/batchImportUsers  { organizationId, eventId, users: [...], idToken, skipAuth? }
// 每個 user 項目: { phoneNumber, password, englishName, chineseName?, email, identityTag, department?, roles[], identityId? }
// 效能策略：
// 1. 先驗證權限與基本欄位
// 2. 一次讀取現有使用者手機集合做重複過濾
// 3. 聚合各部門新增人數，後續一次 transaction 更新 departments
// 4. 使用 Firestore batch 分批寫入 (<=500)
// 5. 使用單次 update 對 event 統計做 FieldValue.increment (彙總後一次送)
exports.batchImportUsersHttp = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST' });

    const start = Date.now();
    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring('Bearer '.length) : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, eventId, users, idToken, skipAuth } = body;
      const effectiveToken = idToken || tokenFromHeader;

      if (!organizationId || !eventId || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ error: '缺少必要參數或 users 為空' });
      }
      if (!effectiveToken) return res.status(401).json({ error: '需要登录' });

      let decoded;
      try { decoded = await admin.auth().verifyIdToken(effectiveToken); } catch (e) { return res.status(401).json({ error: '身份验证失败' }); }
      const callerUid = decoded.uid;

      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventRef = orgRef.collection('events').doc(eventId);
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) return res.status(404).json({ error: '活动不存在' });

      // 權限：確認 callerUid 對應的用戶在 event.admins 中 或 是 Event Manager
      console.log('[batchImportUsersHttp] callerUid:', callerUid);

      let hasPermission = false;
      const eventData = eventSnap.data() || {};
      const admins = Array.isArray(eventData.admins) ? eventData.admins : [];
      const decodedRoles = Array.isArray(decoded.roles) ? decoded.roles : [];

      // ✅ 檢查 0：ID Token Custom Claims 標示為 Event Manager
      if (!hasPermission && decodedRoles.includes('eventManager')) {
        hasPermission = true;
        console.log('[batchImportUsersHttp] Permission granted via ID token roles (eventManager)');
      }

      // ✅ 檢查 1：是否為 Event Manager
      const eventManager = eventData.eventManager;
      if (eventManager && eventManager.authUid && eventManager.authUid === callerUid) {
        hasPermission = true;
        console.log('[batchImportUsersHttp] Permission granted as Event Manager');
      }

      // ✅ 檢查 2：檢查 event.admins 中的手機號
      if (!hasPermission) {
        // 解析 callerUid 中的電話號碼 (如果是 eventManager_ 開頭)
        let phoneFromUid = null;
        if (callerUid.startsWith('eventManager_')) {
          phoneFromUid = callerUid.replace('eventManager_', '');
        } else if (callerUid.startsWith('phone_')) {
          phoneFromUid = callerUid.replace('phone_', '');
        }

        console.log('[batchImportUsersHttp] Checking permissions against event.admins:', admins.map(a => a.phone || a.phoneNumber));

        const normalizePhone = (p) => {
          if (!p) return '';
          let digits = String(p).replace(/[^0-9]/g, '');
          // 統一移除 60 開頭 (如果長度足夠) 或 0 開頭，保留核心號碼
          if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2);
          if (digits.startsWith('0')) digits = digits.substring(1);
          return digits;
        };

        // 檢查 event.admins
        if (phoneFromUid) {
          const coreCaller = normalizePhone(phoneFromUid);

          for (const adm of admins) {
            const admPhone = adm && (adm.phone || adm.phoneNumber);
            if (!admPhone) continue;

            const coreAdmin = normalizePhone(admPhone);

            // 比較核心號碼
            if (coreCaller === coreAdmin) {
              hasPermission = true;
              console.log('[batchImportUsersHttp] Permission granted via event.admins (phone match)');
              break;
            }
          }
        }
      }

      // ✅ 檢查 3：是否為平台管理員 (admin_uids)
      if (!hasPermission) {
        const adminRef = db.collection('admin_uids').doc(callerUid);
        const adminSnap = await adminRef.get();
        if (adminSnap.exists) {
          hasPermission = true;
          console.log('[batchImportUsersHttp] Permission granted via admin_uids');
        }
      }

      if (!hasPermission) {
        console.error('[batchImportUsersHttp] Permission denied for callerUid:', callerUid);
        return res.status(403).json({ error: '需要 Event Manager 权限' });
      }
      console.log('[batchImportUsersHttp] Permission granted');

      // 讀取現有手機號集合（加速重複檢查）
      const usersCol = eventRef.collection('users');
      const existingSnap = await usersCol.get();
      const existingPhones = new Set();
      existingSnap.forEach(d => { const p = d.data()?.basicInfo?.phoneNumber; if (p) existingPhones.add(String(p)); });

      // 身份標籤驗證準備
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) return res.status(404).json({ error: '组织不存在' });
      const identityTags = (orgSnap.data()?.identityTags || []).filter(t => t.isActive);
      const identityTagMap = new Map(identityTags.map(t => [t.id, t]));

      // 準備批次、部門計數
      const departmentIncrements = new Map(); // key lower-case name -> { displayName, count }
      const statIncrements = {
        totalUsers: 0,
        totalSellerManagers: 0,
        totalMerchantManagers: 0,
        totalCustomerManagers: 0,
        totalSellers: 0,
        totalMerchants: 0,
        totalCustomers: 0
      };

      const batches = [];
      let currentBatch = db.batch();
      let batchOpCount = 0;

      const now = new Date();
      const errors = [];
      let successCount = 0;

      for (const raw of users) {
        // 基本欄位解析
        const {
          phoneNumber,
          password,
          englishName,
          chineseName = '',
          email = '',
          identityTag = 'staff',
          department = '',
          roles = [],
          identityId = ''
        } = raw || {};

        // 驗證
        if (!phoneNumber || !password || !englishName || !Array.isArray(roles) || roles.length === 0) {
          errors.push({ phoneNumber, reason: '缺少必填字段(需: phoneNumber,password,englishName,roles)' });
          continue;
        }
        if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
          errors.push({ phoneNumber, reason: '密码强度不足' });
          continue;
        }
        if (existingPhones.has(phoneNumber)) {
          errors.push({ phoneNumber, reason: '手机号已存在' });
          continue;
        }
        if (!identityTagMap.has(identityTag)) {
          errors.push({ phoneNumber, reason: `身份标签 ${identityTag} 不存在或未启用` });
          continue;
        }

        // ✅ 统一格式：userId = authUid (phone_60xxx)
        const normalizedPhone = String(phoneNumber).replace(/^0/, '');
        const authUid = `phone_60${normalizedPhone}`;
        const userId = authUid;

        // 可選建立 Auth
        if (!skipAuth) {
          try {
            await admin.auth().getUser(authUid);
          } catch (e) {
            if (e.code === 'auth/user-not-found') {
              try { await admin.auth().createUser({ uid: authUid, displayName: englishName, disabled: false }); } catch (ce) { errors.push({ phoneNumber, reason: '建立 Auth 失败: ' + ce.message }); continue; }
            } else { errors.push({ phoneNumber, reason: '查 Auth 失败: ' + e.message }); continue; }
          }
        }

        // 密碼雜湊
        const passwordSalt = crypto.randomBytes(16).toString('hex');
        const passwordHash = sha256(password + passwordSalt);

        const tagMeta = identityTagMap.get(identityTag);
        const identityName = (tagMeta && tagMeta.name && (tagMeta.name['zh-CN'] || tagMeta.name.zhCN || tagMeta.name.cn)) || identityTag;
        const identityNameEn = (tagMeta && tagMeta.name && (tagMeta.name['en'] || tagMeta.name.en || tagMeta.name['zh-CN'])) || identityTag;
        const identityInfo = {
          identityId: identityId && String(identityId).trim() ? String(identityId).trim() : `${identityTag.toUpperCase()}_${Date.now()}`,
          identityName: identityName,
          identityNameEn: identityNameEn,
          department: department ? department.trim() : '未分配'
        };

        // 構建用戶文檔基礎結構
        const userDoc = {
          userId,
          authUid,
          roles,
          identityTag,
          basicInfo: {
            phoneNumber,
            englishName,
            chineseName,
            // email 可留空；若為空則不寫入欄位
            ...(email && email.trim() ? { email: email.trim() } : {}),

            // 登录密码
            passwordHash,
            passwordSalt,
            hasDefaultPassword: true,        // ← 新增
            isFirstLogin: true,              // ← 新增
            passwordLastChanged: null,       // ← 新增

            // 交易密码（初始为空）
            transactionPinHash: null,        // ← 新增
            transactionPinSalt: null,        // ← 新增
            pinFailedAttempts: 0,            // ← 新增
            pinLockedUntil: null,            // ← 新增
            pinLastChanged: null,            // ← 新增

            isPhoneVerified: true
          },
          identityInfo,
          activityData: { joinedAt: now, lastActiveAt: now, participationStatus: 'active' },
          accountStatus: { status: 'active', mustChangePassword: false, createdAt: now, updatedAt: now },
          metadata: { registrationSource: 'batch_import', operatorUid: callerUid, notes: `批量匯入 - ${roles.join(', ')}` }
        };

        // ✅ 角色資料：改為頂層字段（與 UserManagement.jsx 一致）
        if (roles.includes('sellerManager')) {
          userDoc.sellerManager = {
            managerId: `SM${Date.now()}`,
            assignedCapital: 0,
            availableCapital: 0,
            allocatedToSellers: 0,
            totalSellersManaged: 0,
            managedDepartments: []
          };
        }
        if (roles.includes('merchantManager')) {
          userDoc.merchantManager = {
            managerId: `MM${Date.now()}`,
            totalMerchantsManaged: 0
          };
        }
        if (roles.includes('customerManager')) {
          userDoc.customerManager = {
            managerId: `CM${Date.now()}`,
            totalCustomersManaged: 0,
            totalSalesAmount: 0
          };
        }
        if (roles.includes('seller')) {
          userDoc.seller = {
            sellerId: `SL${Date.now()}`,
            availablePoints: 0,
            currentSalesAmount: 0,
            totalPointsSold: 0,
            transactions: {}
          };
        }
        if (roles.includes('customer')) {
          userDoc.customer = {
            customerId: `CS${Date.now()}`,
            currentBalance: 0,
            totalPointsPurchased: 0,
            totalPointsConsumed: 0
          };
        }

        currentBatch.set(usersCol.doc(userId), userDoc);
        batchOpCount++;
        existingPhones.add(phoneNumber); // 避免後續列表中重複

        // ✅ 修改：设置 Custom Claims（支持多事件）
        if (!skipAuth) {
          try {
            // 读取 event 文档获取 orgCode 和 eventCode
            const eventDoc = await eventRef.get();
            
            if (eventDoc.exists) {
              const eventData = eventDoc.data();
              const orgCode = eventData.orgCode;
              const eventCode = eventData.eventCode;
              
              if (orgCode && eventCode) {
                await updateUserCustomClaims(authUid, orgCode, eventCode, 'add');
                console.log(`[batchImportUsersHttp] ✅ Custom Claims 设置成功: ${authUid}`);
              } else {
                console.warn(`[batchImportUsersHttp] ⚠️ Event 文档缺少 orgCode 或 eventCode`);
              }
            }
          } catch (e) {
            console.error(`[batchImportUsersHttp] ⚠️ Custom Claims 设置失败（非致命）: ${e.message}`);
            // 记录错误但不阻止创建
            errors.push({ phoneNumber, reason: '设置权限失败: ' + e.message });
          }
        }

        // 部門計數
        if (department && department.trim()) {
          const dName = department.trim();
          const key = dName.toLocaleLowerCase();
          const prev = departmentIncrements.get(key) || { displayName: dName, count: 0 };
          prev.count += 1; departmentIncrements.set(key, prev);
        }

        // 統計累加
        statIncrements.totalUsers++;
        if (roles.includes('sellerManager')) statIncrements.totalSellerManagers++;
        if (roles.includes('merchantManager')) statIncrements.totalMerchantManagers++;
        if (roles.includes('customerManager')) statIncrements.totalCustomerManagers++;
        if (roles.includes('seller')) statIncrements.totalSellers++;
        if (roles.includes('customer')) statIncrements.totalCustomers++;

        // 批次切換
        if (batchOpCount >= 450) { // 留餘裕避免超過限制
          batches.push(currentBatch);
          currentBatch = db.batch();
          batchOpCount = 0;
        }
        successCount++;
      }

      if (batchOpCount > 0) batches.push(currentBatch);

      // 提交所有批次
      for (const b of batches) { await b.commit(); }

      // 更新 event 統計
      const eventUpdate = { updatedAt: now };
      Object.entries(statIncrements).forEach(([k, v]) => { if (v > 0) eventUpdate[`statistics.${k}`] = admin.firestore.FieldValue.increment(v); });
      await eventRef.update(eventUpdate);

      // 交易更新部門 userCount（新部門則建立）
      await db.runTransaction(async (tx) => {
        const orgDoc = await tx.get(orgRef);
        if (!orgDoc.exists) return;
        const data = orgDoc.data() || {};
        const departments = Array.isArray(data.departments) ? data.departments : [];
        const map = new Map(departments.map(d => [d && typeof d.name === 'string' ? d.name.trim().toLocaleLowerCase() : '', d]));
        departmentIncrements.forEach(({ displayName, count }, key) => {
          if (!key) return;
          if (map.has(key)) {
            const original = map.get(key);
            map.set(key, { ...original, userCount: (original.userCount || 0) + count });
          } else {
            map.set(key, {
              id: `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: displayName,
              displayOrder: map.size + 1,
              userCount: count,
              createdAt: admin.firestore.Timestamp.fromDate(new Date()),
              createdBy: 'system'
            });
          }
        });
        const next = Array.from(map.values()).filter(Boolean).sort((a, b) => a.displayOrder - b.displayOrder);
        tx.update(orgRef, { departments: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      });

      const elapsed = Date.now() - start;
      return res.status(200).json({
        success: true,
        imported: successCount,
        errors,
        statIncrements,
        departmentIncrements: Array.from(departmentIncrements.values()),
        elapsedMs: elapsed,
        message: `批量匯入完成 (${successCount} 成功 / ${errors.length} 失敗)`
      });
    } catch (e) {
      console.error('[batchImportUsersHttp] Error:', e);
      return res.status(500).json({ error: e && e.message ? e.message : '内部错误' });
    }
  });
});

// ============================================================================
// 修复后的 updateUserRoles 函数
// 替换 admin.js 中第 2675-2835 行的代码
// ============================================================================

// POST /api/updateUserRoles
// Body: { organizationId, eventId, userId, roles: {...}, managedDepartments: [...], previousRoles: [...], idToken }
exports.updateUserRoles = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST' });

    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring('Bearer '.length) : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, eventId, userId, roles, managedDepartments, previousRoles, idToken } = body;
      const effectiveToken = idToken || tokenFromHeader;

      if (!organizationId || !eventId || !userId || !roles) {
        return res.status(400).json({ error: '缺少必要参数' });
      }
      if (!effectiveToken) return res.status(401).json({ error: '需要登录' });

      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(effectiveToken);
      } catch (e) {
        return res.status(401).json({ error: '身份验证失败' });
      }
      const callerUid = decoded.uid;
      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventRef = orgRef.collection('events').doc(eventId);

      // ✅ 使用通用权限检查函数
      const hasPermission = await checkEventManagerPermission(callerUid, orgRef);

      if (!hasPermission) {
        res.status(403).json({ error: '需要 Event Manager 权限' });
        return;
      }

      // 获取目标用户文档
      const userRef = orgRef.collection('events').doc(eventId).collection('users').doc(userId);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ error: '用户不存在' });
      }

      const userData = userSnap.data();
      const currentRoles = userData.roles || [];

      // 检查是否是 Event Manager 修改自己的角色
      const isModifyingSelf = (callerUid === userId) || 
        (callerUid === userData.authUid) ||
        (callerUid === `phone_${userData.basicInfo?.phoneNumber}`) ||
        (callerUid === `eventManager_${userData.basicInfo?.phoneNumber}`);

      // 🚫 规则 1: Event Manager 身份是唯一的且不可修改
      // Event Manager 必须保留其身份，且不能修改自己的任何角色设定
      if (currentRoles.includes('eventManager')) {
        console.log('[updateUserRoles] ❌ 尝试修改 Event Manager 角色被拒绝');
        return res.status(403).json({
          error: 'Event Manager 角色是固定的，不能被修改或移除。',
          code: 'eventmanager-immutable'
        });
      }

      // 🚫 规则 2: 禁止手动指派 Event Manager 角色
      if (roles.eventManager) {
        return res.status(400).json({
          error: '不能手动指派 Event Manager 角色。',
          code: 'cannot-assign-eventmanager'
        });
      }

      // 构建新角色列表
      const newRoles = [];
      const managerRoles = [];
      const participantRoles = [];

      // 分类角色
      if (roles.sellerManager) { newRoles.push('sellerManager'); managerRoles.push('sellerManager'); }
      if (roles.merchantManager) { newRoles.push('merchantManager'); managerRoles.push('merchantManager'); }
      if (roles.customerManager) { newRoles.push('customerManager'); managerRoles.push('customerManager'); }
      if (roles.cashier) { newRoles.push('cashier'); managerRoles.push('cashier'); }
      if (roles.seller) { newRoles.push('seller'); participantRoles.push('seller'); }
      if (roles.merchantOwner) { newRoles.push('merchantOwner'); participantRoles.push('merchantOwner'); }
      if (roles.merchantAsist) { newRoles.push('merchantAsist'); participantRoles.push('merchantAsist'); }
      if (roles.customer) { newRoles.push('customer'); participantRoles.push('customer'); }
      if (roles.pointSeller) { newRoles.push('pointSeller'); participantRoles.push('pointSeller'); }

      // 构建更新数据
      const updateData = {
        roles: newRoles,
        'accountStatus.updatedAt': new Date()
      };

      // 如果勾选了 sellerManager，检查部门唯一性并保存管理部门
      if (roles.sellerManager) {
        // 🆕 检查部门唯一性：一个部门只能有一位 Seller Manager
        if (managedDepartments && managedDepartments.length > 0) {
          const usersCol = eventRef.collection('users');
          const smQuery = await usersCol.where('roles', 'array-contains', 'sellerManager').get();
          
          for (const dept of managedDepartments) {
            const conflictUser = smQuery.docs.find(doc => {
              if (doc.id === userId) return false; // 跳过正在编辑的本人
              const data = doc.data();
              const depts = data.sellerManager?.managedDepartments || [];
              return depts.includes(dept);
            });
            
            if (conflictUser) {
              const conflictData = conflictUser.data();
              const conflictName = conflictData.basicInfo?.chineseName || conflictData.basicInfo?.englishName || '其他管理员';
              return res.status(400).json({
                error: `部门 "${dept}" 已经由 ${conflictName} 管理。一个部门只能指派一名 Seller Manager。`,
                code: 'department-already-managed'
              });
            }
          }
        }

        updateData['sellerManager.managedDepartments'] = managedDepartments || [];

        // 如果是新添加的 sellerManager，初始化其他字段
        if (!previousRoles?.includes('sellerManager')) {
          updateData['sellerManager.allocatedPoints'] = 0;
          updateData['sellerManager.returnedPoints'] = 0;
          updateData['sellerManager.totalPoints'] = 0;
          updateData['sellerManager.transactions'] = {};
        }
      }

      // 初始化新角色的点数账户
      const additionalUpdateData = {};

      if (roles.seller && !previousRoles?.includes('seller')) {
        additionalUpdateData['seller.availablePoints'] = 0;
        additionalUpdateData['seller.totalPointsSold'] = 0;
        additionalUpdateData['seller.transactions'] = {};
      }

      if (roles.customer && !previousRoles?.includes('customer')) {
        additionalUpdateData['customer.availablePoints'] = 0;
        additionalUpdateData['customer.totalPointsSpent'] = 0;
        additionalUpdateData['customer.transactions'] = {};
      }

      if (roles.pointSeller && !previousRoles?.includes('pointSeller')) {
        additionalUpdateData['pointSeller.sellerId'] = `PS${Date.now()}`;
        additionalUpdateData['pointSeller.totalCardsSold'] = 0;
        additionalUpdateData['pointSeller.totalSalesAmount'] = 0;
        additionalUpdateData['pointSeller.cashOnHand'] = 0;
        additionalUpdateData['pointSeller.todayStats'] = {
          cardsIssued: 0,
          totalPointsIssued: 0,
          totalCashReceived: 0,
          directSalesCount: 0,
          directSalesPoints: 0
        };
        additionalUpdateData['pointSeller.totalStats'] = {
          totalCardsIssued: 0,
          totalPointsIssued: 0,
          totalCashReceived: 0
        };
      }

      // 合并更新数据
      const finalUpdateData = { ...updateData, ...additionalUpdateData };

      // 更新用户文档
      await userRef.update(finalUpdateData);

      console.log('[updateUserRoles] ✅ User roles updated successfully:', userId, newRoles);
      return res.status(200).json({
        success: true,
        message: '角色分配成功',
        userId,
        roles: newRoles
      });
    } catch (error) {
      console.error('[updateUserRoles] ❌ Error:', error);
      return res.status(500).json({
        error: error.message || '更新角色失败'
      });
    }
  });
});

// ========== 分配 / 回收 點數 ==========
// POST /api/allocatePointsHttp
// Body: { organizationId, eventId, userId, roleType: 'seller'|'customer', amount, note, idToken }
exports.allocatePointsHttp = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST' });

    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring('Bearer '.length) : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, eventId, userId, roleType, amount, note, idToken } = body;
      const effectiveToken = idToken || tokenFromHeader;

      if (!organizationId || !eventId || !userId || !roleType || !amount) {
        return res.status(400).json({ error: '缺少必要參數' });
      }
      if (!['seller', 'customer'].includes(roleType)) {
        return res.status(400).json({ error: 'roleType 不正確' });
      }
      const points = Number(amount);
      if (!Number.isFinite(points) || points <= 0) {
        return res.status(400).json({ error: 'amount 必須為正整數' });
      }
      if (!effectiveToken) return res.status(401).json({ error: '需要登录' });

      let decoded;
      try { decoded = await admin.auth().verifyIdToken(effectiveToken); } catch { return res.status(401).json({ error: '身份验证失败' }); }
      const callerUid = decoded.uid;

      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventRef = orgRef.collection('events').doc(eventId);
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) return res.status(404).json({ error: '活动不存在' });

      // 權限：接受 custom claims 角色 或 event.admins / eventManager.authUid 或 sellerManager
      let hasPermission = false;
      const decodedRoles = Array.isArray(decoded.roles) ? decoded.roles : [];
      if (decodedRoles.includes('eventManager') || decodedRoles.includes('sellerManager')) hasPermission = true;

      if (!hasPermission) {
        const eventData = eventSnap.data() || {};
        if (eventData.eventManager?.authUid === callerUid) hasPermission = true;

        if (!hasPermission) {
          let phoneFromUid = null;
          if (callerUid.startsWith('eventManager_')) phoneFromUid = callerUid.replace('eventManager_', '');
          else if (callerUid.startsWith('phone_')) phoneFromUid = callerUid.replace('phone_', '');
          const normalizePhone = (p) => { if (!p) return ''; let d = String(p).replace(/[^0-9]/g, ''); if (d.startsWith('60') && d.length > 9) d = d.substring(2); if (d.startsWith('0')) d = d.substring(1); return d; };
          if (phoneFromUid) {
            const coreCaller = normalizePhone(phoneFromUid);
            const admins = Array.isArray(eventData.admins) ? eventData.admins : [];
            for (const adm of admins) { const ap = adm && (adm.phone || adm.phoneNumber); if (ap && normalizePhone(ap) === coreCaller) { hasPermission = true; break; } }
          }
        }
      }

      if (!hasPermission) return res.status(403).json({ error: '需要 Event Manager 权限' });

      // 進行分配
      const userRef = eventRef.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ error: '用户不存在' });

      const tsKey = String(Date.now());
      const tx = {
        type: 'allocation',
        amount: points,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        allocatedBy: callerUid,
        note: note || '点数分配'
      };

      await userRef.update({
        [`${roleType}.availablePoints`]: admin.firestore.FieldValue.increment(points),
        [`${roleType}.transactions.${tsKey}`]: tx,
        'accountStatus.lastUpdated': admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ success: true, userId, roleType, amount: points });
    } catch (error) {
      console.error('[allocatePointsHttp] Error:', error);
      return res.status(500).json({ error: error.message || '内部错误' });
    }
  });
});

// POST /api/recallPointsHttp
// Body: { organizationId, eventId, userId, roleType, amount, note, idToken }
exports.recallPointsHttp = onRequest({ region: 'asia-southeast1' }, async (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: '只支持 POST' });

    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring('Bearer '.length) : null;
      const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
      const { organizationId, eventId, userId, roleType, amount, note, idToken } = body;
      const effectiveToken = idToken || tokenFromHeader;

      if (!organizationId || !eventId || !userId || !roleType || !amount) {
        return res.status(400).json({ error: '缺少必要參數' });
      }
      if (!['seller', 'customer'].includes(roleType)) {
        return res.status(400).json({ error: 'roleType 不正確' });
      }
      const points = Number(amount);
      if (!Number.isFinite(points) || points <= 0) {
        return res.status(400).json({ error: 'amount 必須為正整數' });
      }
      if (!effectiveToken) return res.status(401).json({ error: '需要登录' });

      let decoded;
      try { decoded = await admin.auth().verifyIdToken(effectiveToken); } catch { return res.status(401).json({ error: '身份验证失败' }); }
      const callerUid = decoded.uid;

      const db = getDb();
      const orgRef = db.collection('organizations').doc(organizationId);
      const eventRef = orgRef.collection('events').doc(eventId);
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) return res.status(404).json({ error: '活动不存在' });

      // 權限同上
      let hasPermission = false;
      const decodedRoles = Array.isArray(decoded.roles) ? decoded.roles : [];
      if (decodedRoles.includes('eventManager')) hasPermission = true;
      const eventData = eventSnap.data() || {};
      if (!hasPermission && eventData.eventManager?.authUid === callerUid) hasPermission = true;
      if (!hasPermission) {
        let phoneFromUid = null;
        if (callerUid.startsWith('eventManager_')) phoneFromUid = callerUid.replace('eventManager_', '');
        else if (callerUid.startsWith('phone_')) phoneFromUid = callerUid.replace('phone_', '');
        const normalizePhone = (p) => { if (!p) return ''; let d = String(p).replace(/[^0-9]/g, ''); if (d.startsWith('60') && d.length > 9) d = d.substring(2); if (d.startsWith('0')) d = d.substring(1); return d; };
        if (phoneFromUid) {
          const coreCaller = normalizePhone(phoneFromUid);
          const admins = Array.isArray(eventData.admins) ? eventData.admins : [];
          for (const adm of admins) { const ap = adm && (adm.phone || adm.phoneNumber); if (ap && normalizePhone(ap) === coreCaller) { hasPermission = true; break; } }
        }
      }

      if (!hasPermission) return res.status(403).json({ error: '需要 Event Manager 权限' });

      const userRef = eventRef.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ error: '用户不存在' });

      const tsKey = String(Date.now());
      const tx = {
        type: 'recall',
        amount: -points,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        recalledBy: callerUid,
        note: note || '点数回收'
      };

      await userRef.update({
        [`${roleType}.availablePoints`]: admin.firestore.FieldValue.increment(-points),
        [`${roleType}.transactions.${tsKey}`]: tx,
        'accountStatus.lastUpdated': admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ success: true, userId, roleType, amount: -points });
    } catch (error) {
      console.error('[recallPointsHttp] Error:', error);
      return res.status(500).json({ error: error.message || '内部错误' });
    }
  });
});

// ⚠️ 此函數已廢棄，請使用 createEventByPlatformAdminHttp
// 保留此函數僅供參考或作為備用
exports.createEventByPlatformAdmin = functions.https.onCall(async (data, context) => {
  // 返回錯誤提示
  throw new functions.https.HttpsError(
    'failed-precondition',
    '此函數已廢棄，請使用 createEventByPlatformAdminHttp'
  );
});

// ✅ 修改後的 createEventByPlatformAdminHttp
// 位置：admin.js Line 2789 開始
// 修改內容：
// 1. 移除 contactPerson 參數和驗證
// 2. 移除 Event 文檔中的 contactPerson 字段
// 3. 在 Event Manager 的 identityInfo 中新增 position 字段

exports.createEventByPlatformAdminHttp = onRequest({ region: 'asia-southeast1' }, (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const authHeader = req.headers['authorization'] || '';
      const tokenMatch = authHeader.match(/^Bearer\s+(.*)$/i);
      if (!tokenMatch) {
        return res.status(401).json({ error: 'Missing Authorization Bearer token' });
      }

      const idToken = tokenMatch[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      const callerUid = decoded.uid;

      const adminDoc = await admin.firestore().collection('admin_uids').doc(callerUid).get();
      if (!adminDoc.exists) {
        return res.status(403).json({ error: 'permission-denied: 只有平台管理員可以創建活動' });
      }

      const data = req.body?.data || req.body || {};
      const {
        organizationId,
        eventCode,
        eventName,
        description,
        eventInfo,
        status,
        orgCode,
        // ❌ 移除 contactPerson
        eventManagerInfo    // ✅ Event Manager 信息
      } = data;

      // ✅ 驗證必要參數
      if (!organizationId || !eventCode || !eventName) {
        return res.status(400).json({ error: 'invalid-argument: 缺少必要参数（organizationId, eventCode, eventName）' });
      }

      // ✅ 验证 eventName 结构
      if (typeof eventName !== 'object' || !eventName['zh-CN']) {
        return res.status(400).json({ error: 'invalid-argument: eventName 必须包含中文名称（zh-CN）' });
      }

      // ❌ 移除 contactPerson 驗證

      // ✅ 驗證 eventManagerInfo
      if (!eventManagerInfo || !eventManagerInfo.phoneNumber || !eventManagerInfo.englishName) {
        return res.status(400).json({ error: 'invalid-argument: 缺少 Event Manager 信息（phoneNumber, englishName）' });
      }

      // ✅ 預設密碼邏輯 (對齊 BatchImportUser.jsx)
      let finalPassword = eventManagerInfo.password;
      if (!finalPassword) {
        finalPassword = `${orgCode}${eventCode}`;
        if (finalPassword.length < 8 || !(/[a-zA-Z]/.test(finalPassword) && /\d/.test(finalPassword))) {
          finalPassword = `${finalPassword}Ab12`;
        }
        console.log('[createEventByPlatformAdminHttp] 使用預設密碼:', finalPassword);
      }

      // ✅ 驗證手機號格式
      if (!/^01\d{8,9}$/.test(eventManagerInfo.phoneNumber)) {
        return res.status(400).json({ error: 'invalid-argument: Event Manager 手機號格式不正確' });
      }

      // ✅ 驗證密碼強度
      if (finalPassword.length < 8) {
        return res.status(400).json({ error: 'invalid-argument: Event Manager 密碼至少需要8個字符' });
      }

      if (!/[a-zA-Z]/.test(finalPassword) || !/\d/.test(finalPassword)) {
        return res.status(400).json({ error: 'invalid-argument: Event Manager 密碼必須包含英文字母和數字' });
      }

      // ✅ 獲取 Organization 數據
      const orgRef = admin.firestore().collection('organizations').doc(organizationId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: 'not-found: 組織不存在' });
      }

      const orgData = orgSnap.data();

      // ✨ 验证 identityTag 是否存在于组织的 identityTags 中
      const identityTags = orgData.identityTags || [];
      const validTag = identityTags.find(tag => tag.id === eventManagerInfo.identityTag && tag.isActive);
      if (!validTag) {
        return res.status(400).json({ error: `invalid-argument: 身份標籤 "${eventManagerInfo.identityTag}" 不存在或已停用` });
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      // ✅ 第一步：創建 Event 文檔
      const eventRef = await admin.firestore()
        .collection(`organizations/${organizationId}/events`)
        .add({
          eventCode,
          orgCode,
          eventName: {
            'zh-CN': eventName['zh-CN'],
            'en-US': eventName['en-US'] || eventName['zh-CN']
          },
          description: description || '',
          eventInfo: {
            description: description || '',
            fairDate: eventInfo?.fairDate || null,
            fairTime: eventInfo?.fairTime || null,
            consumptionPeriod: {
              startDate: eventInfo?.consumptionPeriod?.startDate || null,
              endDate: eventInfo?.consumptionPeriod?.endDate || null
            }
          },
          // ❌ 移除 contactPerson 字段
          pointAllocationRules: {
            sellerManager: {
              maxPerAllocation: 100,
              enableWarnings: true,
              warningThreshold: 0.3
            }
          },
          settings: {},
          status: status || 'planning',
          statistics: { totalUsers: 0 },
          roleStats: {
            eventManagers: { count: 0 }
          },
          createdAt: now,
          updatedAt: now,
          createdBy: callerUid
        });

      const eventId = eventRef.id;
      console.log('[createEventByPlatformAdminHttp] Event 創建成功:', eventId);

      // ✅ 第二步：檢查 Event Manager 手機號是否已存在於此活動
      const usersCol = eventRef.collection('users');
      const dupSnap = await usersCol.where('basicInfo.phoneNumber', '==', eventManagerInfo.phoneNumber).limit(1).get();
      if (!dupSnap.empty) {
        await eventRef.delete();
        return res.status(409).json({ error: 'already-exists: Event Manager 手機號已在此活動中存在' });
      }

      // ✅ 驗證 Event Manager 的部門
      if (!eventManagerInfo.department || !eventManagerInfo.department.trim()) {
        await eventRef.delete();
        return res.status(400).json({ error: 'invalid-argument: Event Manager 必須指定部門' });
      }

      const deptName = eventManagerInfo.department.trim();

      // ✅ 第三步：處理部門
      try {
        const departments = orgData.departments || [];
        const deptNameLower = deptName.toLowerCase();

        const existingDeptIndex = departments.findIndex(d =>
          d.name && d.name.toLowerCase() === deptNameLower
        );

        if (existingDeptIndex >= 0) {
          console.log('[createEventByPlatformAdminHttp] 部門已存在，增加 userCount:', deptName);
          departments[existingDeptIndex].userCount = (departments[existingDeptIndex].userCount || 0) + 1;

          await orgRef.update({
            departments: departments,
            updatedAt: now
          });
        } else {
          console.log('[createEventByPlatformAdminHttp] 創建新部門:', deptName);
          const newDept = {
            id: deptName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, ''),
            name: deptName,
            isActive: true,
            userCount: 1,
            displayOrder: departments.length + 1,
            createdBy: 'manual',
            createdAt: new Date()  // ✅ 改用 Date 物件，arrayUnion 不能包含 serverTimestamp()
          };

          await orgRef.update({
            departments: admin.firestore.FieldValue.arrayUnion(newDept),
            updatedAt: now
          });
        }
      } catch (deptErr) {
        console.error('[createEventByPlatformAdminHttp] 部門處理錯誤:', deptErr);
        await eventRef.delete();
        return res.status(500).json({
          error: 'internal: 部門處理失敗 - ' + (deptErr.message || 'unknown')
        });
      }

      // ✅ 第四步：生成密碼哈希
      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const passwordHash = sha256(finalPassword + passwordSalt);

      // ✅ 第五步：生成 userId
      const normalizePhone = (phone) => {
        let digits = String(phone).replace(/[^0-9]/g, '');
        if (digits.startsWith('0')) digits = digits.substring(1);
        return digits;
      };
      const norm = normalizePhone(eventManagerInfo.phoneNumber);
      const userId = `phone_60${norm}`;

      // ✅ 第六步：在 users 集合創建 Event Manager 文檔
      const eventManagerData = {
        userId: userId,
        authUid: userId,
        roles: ['eventManager', 'seller', 'customer'],
        identityTag: eventManagerInfo.identityTag,
        identityInfo: {
          identityId: eventManagerInfo.identityId || `${orgCode}${eventCode}`,
          identityName: validTag.name['zh-CN'] || validTag.name['en-US'] || eventManagerInfo.identityTag,
          identityNameEn: validTag.name['en-US'] || validTag.name['zh-CN'] || eventManagerInfo.identityTag,
          department: deptName,
          position: eventManagerInfo.position || '活动负责人'  // ✅ 新增 position 字段
        },
        basicInfo: {
          phoneNumber: eventManagerInfo.phoneNumber,
          englishName: eventManagerInfo.englishName,
          chineseName: eventManagerInfo.chineseName || '',
          email: eventManagerInfo.email || '',
          passwordHash: passwordHash,
          passwordSalt: passwordSalt,
          hasDefaultPassword: true,
          isFirstLogin: true,
          passwordLastChanged: null,

          transactionPinHash: null,
          transactionPinSalt: null,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          pinLastChanged: null,
          isPhoneVerified: true
        },// 初始化 seller 账户
        seller: {
          availablePoints: 0,
          totalPointsSold: 0,
          transactions: {}
        },
        // 初始化 customer 账户
        customer: {
          availablePoints: 0,
          totalPointsSpent: 0,
          transactions: {}
        },
        eventManager: {
          permissions: {
            canManageUsers: true,
            canManageRoles: true,
            canAssignManagers: true,
            canViewAllData: true,
            canMonitorAll: true,
            canModifyEventSettings: true
          },
          restrictions: {
            cannotAllocatePoints: true,
            cannotModifyOwnRoles: true,
            cannotDeleteSelf: true,
            cannotHoldOtherManagerRoles: true
          },
          monitoringScope: {
            canMonitorCashier: true,
            canMonitorSellerManager: true,
            canMonitorAllTransactions: true,
            canViewAllStats: true
          }
        },
        accountStatus: {
          isActive: true,
          isSuspended: false,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now
        },
        activityData: {
          lastActiveAt: null,
          totalLogins: 0,
          createdAt: now,
          updatedAt: now,
          createdBy: callerUid
        },

      };

      await usersCol.doc(userId).set(eventManagerData);

      // ✅ 更新 Event 文檔：添加 eventManager 基本聯絡信息和 roleStats
      await eventRef.update({
        eventManager: {
          authUid: userId,  // ✅ 添加 authUid 用于权限验证
          chineseName: eventManagerInfo.chineseName || '',
          englishName: eventManagerInfo.englishName,
          phoneNumber: eventManagerInfo.phoneNumber,
          position: eventManagerInfo.position || '活动负责人'
        },
        'roleStats.eventManagers.count': 1,
        'statistics.totalUsers': admin.firestore.FieldValue.increment(1)
      });

      console.log('[createEventByPlatformAdminHttp] Event Manager 創建成功:', userId);

      // ✅ 新增：设置 Custom Claims（支持多事件）
      try {
        console.log('[createEventByPlatformAdminHttp] 设置 Custom Claims...');
        
        // 使用传入的 orgCode 和 eventCode
        if (orgCode && eventCode) {
          await updateUserCustomClaims(userId, orgCode, eventCode, 'add');
          console.log('[createEventByPlatformAdminHttp] ✅ Custom Claims 设置成功:', userId);
        } else {
          console.warn('[createEventByPlatformAdminHttp] ⚠️ 缺少 orgCode 或 eventCode');
        }
      } catch (claimsError) {
        // Custom Claims 设置失败不影响 Event Manager 创建
        console.error('[createEventByPlatformAdminHttp] ⚠️ Custom Claims 设置失败（非致命）:', claimsError.message);
      }

      return res.status(200).json({
        success: true,
        eventId: eventId,
        eventManagerUserId: userId,
        message: 'Event 和 Event Manager 創建成功'
      });

    } catch (err) {
      console.error('createEventByPlatformAdminHttp error:', err);
      return res.status(500).json({
        error: err.message || 'internal'
      });
    }
  });
});

/**
 * submitCashToFinance Cloud Function
 * 
 * 用途：處理 Seller Manager 上交現金給 Cashier
 * 
 * 為什麼需要這個 Cloud Function？
 * - Firestore Security Rules 不允許 Seller Manager 直接更新 Cashier 的文檔
 * - Cloud Function 使用 Admin SDK，擁有完全權限
 * - 可以實現複雜的驗證和業務邏輯
 * 
 * 添加到 functions/admin.js 中
 */

/**
 * 上交現金給 Cashier
 * 
 * HTTP Endpoint: POST
 * 
 * Request Body:
 * {
 *   organizationId: string,
 *   eventId: string,
 *   cashierId: string,
 *   selectedCollections: string[],
 *   totalAmount: number,
 *   note: string (optional)
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   message: string,
 *   submissionId: string
 * }
 */
exports.submitCashToFinanceHttp = onRequest(
  { region: 'asia-southeast1' },
  (req, res) => {
    corsHandler(req, res, async () => {
      // 只允許 POST（OPTIONS 由 corsHandler 自動處理）
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      try {
        // ========== 步驟 1: 驗證 Authorization ==========
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: '未提供授權 Token' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const callerUid = decodedToken.uid;

        console.log('[submitCashToFinance] 調用者 UID:', callerUid);

        // ========== 步驟 2: 解析請求參數 ==========
        const {
          organizationId,
          eventId,
          cashierId,
          selectedCollections,
          totalAmount,
          note
        } = req.body;

        // 參數驗證
        if (!organizationId || !eventId || !cashierId) {
          return res.status(400).json({
            error: '缺少必要參數：organizationId, eventId, cashierId'
          });
        }

        if (!selectedCollections || selectedCollections.length === 0) {
          return res.status(400).json({
            error: '至少需要選擇一筆收款記錄'
          });
        }

        if (!totalAmount || totalAmount <= 0) {
          return res.status(400).json({
            error: '總金額必須大於 0'
          });
        }

        console.log('[submitCashToFinance] 參數驗證通過');
        console.log('  - organizationId:', organizationId);
        console.log('  - eventId:', eventId);
        console.log('  - cashierId:', cashierId);
        console.log('  - 收款記錄數:', selectedCollections.length);
        console.log('  - 總金額:', totalAmount);

        // ========== 步驟 3: 驗證調用者是 Seller Manager ==========
        const db = getDb();
        const smDocRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(callerUid);

        const smDoc = await smDocRef.get();

        if (!smDoc.exists) {
          return res.status(403).json({
            error: '找不到用戶記錄'
          });
        }

        const smData = smDoc.data();
        if (!smData.roles || !smData.roles.includes('sellerManager')) {
          return res.status(403).json({
            error: '只有 Seller Manager 可以上交現金'
          });
        }

        console.log('[submitCashToFinance] Seller Manager 驗證通過:', smData.basicInfo?.chineseName);

        // ========== 步驟 4: 驗證 Cashier 存在 ==========
        const fmDocRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(cashierId);

        const fmDoc = await fmDocRef.get();

        if (!fmDoc.exists) {
          return res.status(404).json({
            error: '找不到指定的 Cashier'
          });
        }

        const fmData = fmDoc.data();
        if (!fmData.roles || !fmData.roles.includes('cashier')) {
          return res.status(400).json({
            error: '指定的用戶不是 Cashier'
          });
        }

        console.log('[submitCashToFinance] Cashier 驗證通過:', fmData.basicInfo?.chineseName);

        // ========== 步驟 5: 驗證 cashCollections 存在且狀態正確 ==========
        const collectionsSnapshot = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('cashCollections')
          .where(admin.firestore.FieldPath.documentId(), 'in', selectedCollections)
          .get();

        if (collectionsSnapshot.size !== selectedCollections.length) {
          return res.status(400).json({
            error: `找不到所有指定的收款記錄（找到 ${collectionsSnapshot.size}/${selectedCollections.length}）`
          });
        }

        // 檢查狀態
        const invalidCollections = [];
        collectionsSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.status !== 'collected') {
            invalidCollections.push(doc.id);
          }
          if (data.collectedBy !== callerUid) {
            invalidCollections.push(`${doc.id} (不是由您收款的)`);
          }
        });

        if (invalidCollections.length > 0) {
          return res.status(400).json({
            error: `部分收款記錄無效或狀態不正確：${invalidCollections.join(', ')}`
          });
        }

        console.log('[submitCashToFinance] 收款記錄驗證通過');

        // ========== 步驟 6: 計算明細統計 ==========
        const breakdown = {
          normalCollections: 0,
          partialCollections: 0,
          pointsRecovery: 0,
          waivers: 0,
          totalDiscrepancy: 0
        };

        collectionsSnapshot.forEach(doc => {
          const data = doc.data();
          const amount = data.amount || 0;

          if (!data.discrepancy || data.discrepancy === 0) {
            breakdown.normalCollections += amount;
          } else {
            switch (data.discrepancyType) {
              case 'partial':
                breakdown.partialCollections += amount;
                break;
              case 'pointsRecovery':
                breakdown.pointsRecovery += amount;
                break;
              case 'waiver':
                breakdown.waivers += amount;
                break;
            }
            breakdown.totalDiscrepancy += (data.discrepancy || 0);
          }
        });

        // ========== 步驟 7: 執行 Batch 操作 ==========
        const batch = db.batch();

        // 7.1 創建 cashSubmission 記錄
        const submissionRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('cashSubmissions').doc();

        const managedDepartments = smData.sellerManager?.managedDepartments || [];

        batch.set(submissionRef, {
          submissionId: submissionRef.id,
          type: 'managerToFinance',

          // 提交方
          submittedBy: callerUid,
          submittedByName: smData.basicInfo?.chineseName || 'Seller Manager',
          submittedByRole: 'sellerManager',
          submittedByDepartments: managedDepartments,

          // 接收方
          receivedBy: cashierId,
          receivedByName: fmData.basicInfo?.chineseName || fmData.displayName || 'Cashier',
          receivedByRole: 'cashier',

          // 金額信息
          totalAmount: totalAmount,
          collectionCount: selectedCollections.length,
          includedCollections: selectedCollections,

          // 明細統計
          breakdown: breakdown,

          // 狀態
          status: 'pending',
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmedAt: null,
          rejectedAt: null,
          rejectionReason: null,

          // 關聯
          eventId: eventId,
          organizationId: organizationId,

          // 備註
          note: note || '',
          financeNote: null,

          // 時間戳
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[submitCashToFinance] 創建 cashSubmission:', submissionRef.id);

        // 7.2 更新每個 cashCollection 的狀態
        selectedCollections.forEach(collectionId => {
          const collectionRef = db
            .collection('organizations').doc(organizationId)
            .collection('events').doc(eventId)
            .collection('cashCollections').doc(collectionId);

          batch.update(collectionRef, {
            status: 'submitted',
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            submissionId: submissionRef.id,
            submittedToCashier: cashierId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        console.log('[submitCashToFinance] 更新 cashCollections:', selectedCollections.length, '筆');

        // 7.3 更新 Seller Manager 的 cashFlow 統計
        batch.update(smDocRef, {
          'pointsStats.cashFlow.cashHolding': admin.firestore.FieldValue.increment(-totalAmount),
          'pointsStats.cashFlow.submittedToFinance': admin.firestore.FieldValue.increment(totalAmount),
          'pointsStats.cashFlow.lastSubmissionAt': admin.firestore.FieldValue.serverTimestamp(),
          'updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[submitCashToFinance] 更新 Seller Manager 統計');

        // 7.4 更新 Cashier 的統計
        // ✨ 這是關鍵！Admin SDK 有權限更新 Cashier 文檔
        batch.update(fmDocRef, {
          'cashier.totalCashReceived': admin.firestore.FieldValue.increment(totalAmount),
          'cashier.pendingVerification': admin.firestore.FieldValue.increment(totalAmount),
          'cashier.submissionsReceived': admin.firestore.FieldValue.increment(1),
          'cashier.lastSubmissionReceived': admin.firestore.FieldValue.serverTimestamp(),
          'updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[submitCashToFinance] 更新 Cashier 統計');

        // ========== 步驟 8: 提交 Batch ==========
        await batch.commit();

        console.log('[submitCashToFinance] ✅ Batch 提交成功');

        // ========== 步驟 9: 返回成功響應 ==========
        return res.status(200).json({
          success: true,
          message: '上交成功',
          submissionId: submissionRef.id,
          data: {
            submittedBy: smData.basicInfo?.chineseName,
            receivedBy: fmData.basicInfo?.chineseName,
            totalAmount: totalAmount,
            collectionCount: selectedCollections.length
          }
        });

      } catch (error) {
        console.error('[submitCashToFinance] ❌ 錯誤:', error);
        return res.status(500).json({
          error: '上交失敗',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });
  }
);
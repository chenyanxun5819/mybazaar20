const admin = require('firebase-admin');
const functions = require('firebase-functions');
const crypto = require('crypto');

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

  // 解析 UID 中的电话号码
  let phoneFromUid = null;
  if (callerUid.startsWith('eventManager_')) {
    phoneFromUid = callerUid.replace('eventManager_', '');
  } else if (callerUid.startsWith('phone_')) {
    phoneFromUid = callerUid.replace('phone_', '');
  }

  if (!phoneFromUid) return false;

  // 标准化电话号码
  const normalizePhone = (p) => {
    if (!p) return '';
    let digits = String(p).replace(/[^0-9]/g, '');
    if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2);
    if (digits.startsWith('0')) digits = digits.substring(1);
    return digits;
  };

  const coreCaller = normalizePhone(phoneFromUid);

  // 检查所有活动的 admins 数组
  try {
    const eventsSnapshot = await orgRef.collection('events').get();
    for (const eventDoc of eventsSnapshot.docs) {
      const eventData = eventDoc.data();
      const admins = Array.isArray(eventData.admins) ? eventData.admins : [];

      for (const admin of admins) {
        const adminPhone = admin.phone || admin.phoneNumber;
        if (!adminPhone) continue;

        const coreAdmin = normalizePhone(adminPhone);
        if (coreCaller === coreAdmin) {
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
exports.createEventManager = functions.https.onCall(async (data, context) => {
  try {
    const actual = data && data.data ? data.data : data;
    const {
      organizationId,
      eventId,
      phoneNumber,
      password,
      englishName,
      chineseName = '',
      email = '',
      identityTag = 'staff'
    } = actual || {};

    // Verify caller is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', '需要登录');
    }
    const callerUid = context.auth.uid;

    // Verify caller is platform admin
    const adminCheck = await getDb().collection('admin_uids').doc(callerUid).get();
    if (!adminCheck.exists) {
      throw new functions.https.HttpsError('permission-denied', '只有平台管理员可以创建 Event Manager');
    }

    // Validate inputs
    if (!organizationId || !eventId) {
      throw new functions.https.HttpsError('invalid-argument', '缺少组织或活动编号');
    }
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', '请输入有效的手机号');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new functions.https.HttpsError('invalid-argument', '密码至少需要 8 个字符');
    }
    if (!englishName) {
      throw new functions.https.HttpsError('invalid-argument', '英文名为必填');
    }

    // Locate organization and event
    const orgRef = getDb().collection('organizations').doc(organizationId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
      throw new functions.https.HttpsError('not-found', '组织不存在');
    }

    const orgData = orgSnap.data();

    // ✨ 验证 identityTag 是否存在于组织的 identityTags 中
    const identityTags = orgData.identityTags || [];
    const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
    if (!validTag) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `身份标签 "${identityTag}" 不存在或已停用，请在组织设置中检查可用的身份标签`
      );
    }

    const eventRef = orgRef.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      throw new functions.https.HttpsError('not-found', '活动不存在');
    }
    const eventData = eventSnap.data() || {};
    if (eventData.eventManager) {
      throw new functions.https.HttpsError('already-exists', '此活动已指派 Event Manager');
    }

    // Check duplicate phone within the event users
    const usersCol = eventRef.collection('users');
    const dupSnap = await usersCol
      .where('basicInfo.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      throw new functions.https.HttpsError('already-exists', '该手机号已在此活动中存在');
    }

    // Prepare password hash/salt
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = sha256(password + passwordSalt);

    const now = new Date();

    // Event Manager 只儲存在 Event.eventManager 物件中，不在 users 集合中
    const eventManagerData = {
      authUid: `eventManager_${phoneNumber}`,
      displayName: englishName,
      chineseName,
      englishName,
      email,
      phoneNumber,
      password: passwordHash,
      passwordSalt,
      addedAt: now,
      addedBy: callerUid
    };

    // Update event document with eventManager object
    await eventRef.update({
      eventManager: eventManagerData,
      'statistics.totalManagers': admin.firestore.FieldValue.increment(1),
      updatedAt: now
    });
    console.log('[createEventManager] Event eventManager object updated:', phoneNumber);

    return {
      success: true,
      phoneNumber,
      message: 'Event Manager 创建成功'
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) {
      throw err;
    }
    console.error('[createEventManager] Error:', err);
    throw new functions.https.HttpsError('internal', err.message || '内部错误');
  }
});

// ========== Event Manager 创建（HTTP 版本，经由 Hosting /api/createEventManager，Authorization: Bearer <ID Token>） ==========
exports.createEventManagerHttp = functions.https.onRequest(async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method-not-allowed', message: '只支持 POST' } });
  }

  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'unauthenticated', message: '需要登录' } });
    }

    const idToken = authHeader.substring('Bearer '.length);
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: { code: 'unauthenticated', message: '无效的凭证' } });
    }

    const callerUid = decoded.uid;
    // Verify platform admin
    const adminCheck = await getDb().collection('admin_uids').doc(callerUid).get();
    if (!adminCheck.exists) {
      return res.status(403).json({ error: { code: 'permission-denied', message: '只有平台管理员可以创建 Event Manager' } });
    }

    const {
      organizationId,
      eventId,
      phoneNumber,
      password,
      englishName,
      chineseName = '',
      email = '',
      identityTag = 'staff',
      identityId
    } = req.body || {};

    if (!organizationId || !eventId) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '缺少组织或活动编号' } });
    }
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '请输入有效的手机号' } });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '密码至少需要 8 个字符' } });
    }
    if (!englishName) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: '英文名为必填' } });
    }

    const orgRef = getDb().collection('organizations').doc(organizationId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
      return res.status(404).json({ error: { code: 'not-found', message: '组织不存在' } });
    }
    const orgData = orgSnap.data();
    const identityTags = orgData.identityTags || [];
    const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
    if (!validTag) {
      return res.status(400).json({ error: { code: 'invalid-argument', message: `身份标签 "${identityTag}" 不存在或已停用` } });
    }

    const eventRef = orgRef.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return res.status(404).json({ error: { code: 'not-found', message: '活动不存在' } });
    }
    const eventData = eventSnap.data() || {};

    // 检查活动是否已有 Event Manager
    if (eventData.eventManager) {
      return res.status(409).json({ error: { code: 'already-exists', message: '此活动已指派 Event Manager' } });
    }

    const usersCol = eventRef.collection('users');
    const dupSnap = await usersCol.where('basicInfo.phoneNumber', '==', phoneNumber).limit(1).get();
    if (!dupSnap.empty) {
      return res.status(409).json({ error: { code: 'already-exists', message: '该手机号已在此活动中存在' } });
    }

    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = sha256(password + passwordSalt);

    const now = new Date();

    // 💾 Event Manager 只儲存在 Event.eventManager 物件中，不在 users 集合
    const eventManagerData = {
      authUid: `eventManager_${phoneNumber}`,
      displayName: englishName,
      chineseName,
      englishName,
      email,
      phoneNumber,
      password: passwordHash,
      passwordSalt,
      identityTag,
      department: (req.body?.department && String(req.body.department).trim()) || '未分配',
      identityId: identityId && String(identityId).trim()
        ? String(identityId).trim()
        : `${identityTag.toUpperCase()}_${Date.now()}`,
      addedAt: now,
      addedBy: callerUid
    };

    // 更新事件文件：只設置 Event.eventManager 物件
    const eventUpdateData = {
      eventManager: eventManagerData,
      updatedAt: now
    };

    await eventRef.update(eventUpdateData);

    console.log('[createEventManagerHttp] Event Manager 已儲存到 Event.eventManager:', {
      phoneNumber,
      eventId,
      organizationId
    });

    return res.status(200).json({ 
      success: true, 
      phoneNumber,
      message: 'Event Manager 创建成功' 
    });
  } catch (error) {
    console.error('[createEventManagerHttp] Error:', error);
    const code = error.code || 'internal';
    const message = error.message || '内部错误';
    return res.status(code === 'unauthenticated' ? 401 : code === 'permission-denied' ? 403 : 500)
      .json({ error: { code, message } });
  }
});

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
      pinHash: passwordHash,
      pinSalt: passwordSalt,
      passwordHash: passwordHash,
      passwordSalt: passwordSalt,
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
        pinHash: passwordHash,
        pinSalt: passwordSalt,
        passwordHash: passwordHash,
        passwordSalt: passwordSalt,
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



exports.createUserByEventManagerHttp = functions.https.onRequest(async (req, res) => {
  // 设置 CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // 处理 OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // 只允许 POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
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

    // 验证必填字段
    if (!organizationId || !eventId || !phoneNumber || !password || !englishName || !email) {
      res.status(400).json({ error: '缺少必填字段' });
      return;
    }

    // 验证至少有一个角色
    if (!roles || roles.length === 0) {
      res.status(400).json({ error: '至少需要选择一个角色' });
      return;
    }

    // 验证角色是否有效
    const validRoles = ['sellerManager', 'merchantManager', 'customerManager', 'seller', 'merchant', 'customer'];
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

    const eventDoc = await getDb()
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
      .doc(eventId)
      .get();

    if (!eventDoc.exists) {
      res.status(404).json({ error: '活动不存在' });
      return;
    }



    // 2. 检查手机号是否已存在
    const usersCol = getDb()
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
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
    const identityInfo = {
      identityId: identityId && String(identityId).trim()
        ? String(identityId).trim()
        : `${identityTag.toUpperCase()}_${Date.now()}`,
      identityName: validTag.name['zh-CN'],
      identityNameEn: validTag.name['en'],
      department: department || '未分配'
    };

    // 8. 创建用户文档
    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date();

    const userDoc = {
      userId: userId,
      authUid: authUid,
      roles: roles,
      identityTag: identityTag,
      basicInfo: {
        phoneNumber: phoneNumber,
        englishName: englishName,
        chineseName: chineseName,
        email: email,
        passwordHash: passwordHash,
        passwordSalt: passwordSalt,
        pinHash: passwordHash,
        pinSalt: passwordSalt,
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

    if (roles.includes('merchant')) {
      userDoc.merchant = {
        merchantId: `MR${Date.now()}`,
        monthlyReceivedPoints: 0,
        totalReceivedPoints: 0
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
    if (roles.includes('merchant')) {
      updateData['statistics.totalMerchants'] = admin.firestore.FieldValue.increment(1);
    }
    if (roles.includes('customer')) {
      updateData['statistics.totalCustomers'] = admin.firestore.FieldValue.increment(1);
    }

    await getDb()
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
      .doc(eventId)
      .update(updateData);

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
exports.deleteEventHttp = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Only POST requests are allowed' });
    return;
  }

  try {
    const { organizationId, eventId, idToken } = req.body;

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
    try {
      const remainingEvents = await orgRef.collection('events').get();
      const counterAll = new Map();
      for (const ev of remainingEvents.docs) {
        const usersSnapshot = await ev.ref.collection('users').get();
        usersSnapshot.forEach(u => {
          const name = u.data()?.identityInfo?.department;
          if (typeof name === 'string' && name.trim()) {
            const display = name.trim();
            const key = display.toLocaleLowerCase();
            const prev = counterAll.get(key) || { displayName: display, count: 0 };
            prev.count += 1; counterAll.set(key, prev);
          }
        });
      }

      await db.runTransaction(async (tx) => {
        const orgDoc = await tx.get(orgRef);
        if (!orgDoc.exists) return;
        const data = orgDoc.data() || {};
        const current = Array.isArray(data.departments) ? data.departments : [];
        const byKey = new Map(current.map(d => [typeof d.name === 'string' ? d.name.trim().toLocaleLowerCase() : '', d]));
        const merged = [];
        let order = 1;
        current.forEach(d => {
          if (!d || typeof d.name !== 'string') return;
          const key = d.name.trim().toLocaleLowerCase();
          const cnt = counterAll.get(key)?.count || 0;
          // 若為 system 建立且計數為 0，可選擇清理；這裡直接清理
          if (cnt === 0 && (d.createdBy === 'system' || !d.createdBy)) return;
          merged.push({ ...d, userCount: cnt, displayOrder: order++ });
        });
        // 加入新的（counter 有但 current 沒有）
        counterAll.forEach((stat, key) => {
          if (!byKey.has(key)) {
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
        tx.update(orgRef, { departments: merged, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      });
      console.log('[deleteEventHttp] Departments fully recounted post-deletion');
    } catch (fullRecountErr) {
      console.error('[deleteEventHttp] Full recount after deletion failed:', fullRecountErr && fullRecountErr.message);
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

/**
 * HTTP function to check for duplicate users before batch import
 * - Input: organizationId, eventId, phoneNumbers (array of phone numbers)
 * - Output: { duplicates: [phone1, phone2, ...], message }
 */
exports.checkDuplicateUsers = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

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
exports.addDepartment = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

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

/**
 * HTTP function: Delete a department
 */
exports.deleteDepartment = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

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

/**
 * HTTP function: Update department display order
 */
exports.reorderDepartments = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

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

exports.addDepartmentIfNew = addDepartmentIfNew;

// ========== 單一入口：部門管理（CRUD + 排序 + 查詢） ==========
// POST /api/departments  { action: 'add'|'delete'|'reorder'|'list', ... }
// 可接受 Authorization: Bearer <idToken> 或 body.idToken
exports.departmentsHttp = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).send('');

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

      // ✅ 檢查所有活動的 Event Manager 和 admins
      const eventsSnapshot = await orgRef.collection('events').get();
      for (const eventDoc of eventsSnapshot.docs) {
        const eventData = eventDoc.data();

        // ✅ 檢查 1：Event Manager (新架構)
        const eventManager = eventData.eventManager;
        if (eventManager && eventManager.authUid && eventManager.authUid === callerUid) {
          console.log('[departmentsHttp] Permission granted as Event Manager');
          return true;
        }

        // ✅ 檢查 2：檢查 admins 數組（舊架構相容）
        const admins = Array.isArray(eventData.admins) ? eventData.admins : [];

        // 解析 callerUid 中的電話號碼
        let phoneFromUid = null;
        if (callerUid.startsWith('eventManager_')) {
          phoneFromUid = callerUid.replace('eventManager_', '');
        } else if (callerUid.startsWith('phone_')) {
          phoneFromUid = callerUid.replace('phone_', '');
        }

        if (phoneFromUid) {
          // 標準化電話號碼
          const normalizePhone = (p) => {
            if (!p) return '';
            let digits = String(p).replace(/[^0-9]/g, '');
            if (digits.startsWith('60') && digits.length > 9) digits = digits.substring(2);
            if (digits.startsWith('0')) digits = digits.substring(1);
            return digits;
          };

          const coreCaller = normalizePhone(phoneFromUid);

          for (const admin of admins) {
            const adminPhone = admin.phone || admin.phoneNumber;
            if (!adminPhone) continue;

            const coreAdmin = normalizePhone(adminPhone);
            if (coreCaller === coreAdmin) {
              console.log('[departmentsHttp] Permission granted via event.admins (phone match)');
              return true;
            }
          }
        }
      }

      console.log('[departmentsHttp] Permission denied for:', callerUid);
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
              // 若不同大小寫以首次出現為準
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

// ========== 批量匯入使用者（Event Manager） ==========
// POST /api/batchImportUsers  { organizationId, eventId, users: [...], idToken, skipAuth? }
// 每個 user 項目: { phoneNumber, password, englishName, chineseName?, email, identityTag, department?, roles[], identityId? }
// 效能策略：
// 1. 先驗證權限與基本欄位
// 2. 一次讀取現有使用者手機集合做重複過濾
// 3. 聚合各部門新增人數，後續一次 transaction 更新 departments
// 4. 使用 Firestore batch 分批寫入 (<=500)
// 5. 使用單次 update 對 event 統計做 FieldValue.increment (彙總後一次送)
exports.batchImportUsersHttp = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
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
        // 兼容舊版 authUid 格式
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
      if (password.length < 8 || !(/[a-zA-Z]/.test(password) && /\d/.test(password))) {
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

      // 構建 userId / authUid
      const userId = `usr_${crypto.randomUUID()}`;
      const normalizedPhone = String(phoneNumber).replace(/^0/, '');
      const authUid = `phone_60${normalizedPhone}`;

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
      const identityInfo = {
        identityId: identityId && String(identityId).trim() ? String(identityId).trim() : `${identityTag.toUpperCase()}_${Date.now()}`,
        identityName: tagMeta.name['zh-CN'],
        identityNameEn: tagMeta.name['en'],
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
          passwordHash,
          passwordSalt,
          pinHash: passwordHash,
          pinSalt: passwordSalt,
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
      if (roles.includes('merchant')) {
        userDoc.merchant = { 
          merchantId: `MR${Date.now()}`, 
          monthlyReceivedPoints: 0, 
          totalReceivedPoints: 0 
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
      if (roles.includes('merchant')) statIncrements.totalMerchants++;
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

// ========== 更新用戶角色 ==========
// POST /api/updateUserRoles
// Body: { organizationId, eventId, userId, roles: {...}, managedDepartments: [...], previousRoles: [...], idToken }
exports.updateUserRoles = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).send('');
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
    const eventSnap = await eventRef.get();
    
    if (!eventSnap.exists) {
      return res.status(404).json({ error: '活动不存在' });
    }

    // 權限檢查：確認 callerUid 在 event.admins 中
    console.log('[updateUserRoles] callerUid:', callerUid);
    
    let phoneFromUid = null;
    if (callerUid.startsWith('eventManager_')) {
      phoneFromUid = callerUid.replace('eventManager_', '');
    } else if (callerUid.startsWith('phone_')) {
      phoneFromUid = callerUid.replace('phone_', '');
    }

    let hasPermission = false;
    const eventData = eventSnap.data() || {};
    const admins = Array.isArray(eventData.admins) ? eventData.admins : [];
    
    const normalizePhone = (p) => {
      if (!p) return '';
      let digits = String(p).replace(/[^0-9]/g, '');
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
        if (coreCaller === coreAdmin) {
          hasPermission = true;
          console.log('[updateUserRoles] Permission granted via event.admins (phone match)');
          break;
        }
      }
    }

    // 檢查平台管理員
    if (!hasPermission) {
      const adminRef = db.collection('admin_uids').doc(callerUid);
      const adminSnap = await adminRef.get();
      if (adminSnap.exists) {
        hasPermission = true;
        console.log('[updateUserRoles] Permission granted via admin_uids');
      }
    }

    if (!hasPermission) {
      console.error('[updateUserRoles] Permission denied for callerUid:', callerUid);
      return res.status(403).json({ error: '需要 Event Manager 权限' });
    }

    // 構建新角色列表
    const newRoles = [];
    if (roles.sellerManager) newRoles.push('sellerManager');
    if (roles.merchantManager) newRoles.push('merchantManager');
    if (roles.customerManager) newRoles.push('customerManager');
    if (roles.financeManager) newRoles.push('financeManager');
    if (roles.seller) newRoles.push('seller');
    if (roles.merchant) newRoles.push('merchant');
    if (roles.customer) newRoles.push('customer');

    const userRef = eventRef.collection('users').doc(userId);
    const updateData = {
      roles: newRoles,
      'accountStatus.updatedAt': new Date()
    };

    // 如果勾選了 sellerManager，保存管理部門
    if (roles.sellerManager) {
      updateData['sellerManager.managedDepartments'] = managedDepartments;
      
      // 如果是新添加的 sellerManager，初始化其他欄位
      if (!previousRoles?.includes('sellerManager')) {
        updateData['sellerManager.allocatedPoints'] = 0;
        updateData['sellerManager.returnedPoints'] = 0;
        updateData['sellerManager.totalPoints'] = 0;
        updateData['sellerManager.transactions'] = {};
      }
    }

    // 初始化新角色的點數賬戶
    const additionalUpdateData = {};

    if (roles.seller && !previousRoles?.includes('seller')) {
      additionalUpdateData['seller.availablePoints'] = 0;
      additionalUpdateData['seller.totalPointsSold'] = 0;
      additionalUpdateData['seller.transactions'] = {};
    }

    if (roles.merchant && !previousRoles?.includes('merchant')) {
      additionalUpdateData['merchant.availablePoints'] = 0;
      additionalUpdateData['merchant.totalPointsSold'] = 0;
      additionalUpdateData['merchant.transactions'] = {};
    }

    if (roles.customer && !previousRoles?.includes('customer')) {
      additionalUpdateData['customer.availablePoints'] = 0;
      additionalUpdateData['customer.totalPointsSpent'] = 0;
      additionalUpdateData['customer.transactions'] = {};
    }

    // 合併更新數據
    const finalUpdateData = { ...updateData, ...additionalUpdateData };

    await userRef.update(finalUpdateData);

    console.log('[updateUserRoles] User roles updated:', userId, newRoles);
    return res.status(200).json({
      success: true,
      message: '角色分配成功',
      userId,
      roles: newRoles
    });
  } catch (error) {
    console.error('[updateUserRoles] Error:', error);
    return res.status(500).json({
      error: error.message || '更新角色失败'
    });
  }
});
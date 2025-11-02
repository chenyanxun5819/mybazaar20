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

    // Prepare password hash/salt (compatible with loginWithPin which checks passwordHash/pinHash)
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = sha256(password + passwordSalt);

    const newUserId = `usr_${crypto.randomUUID()}`;
    const now = new Date();

    const userDoc = {
      userId: newUserId,
      authUid: newUserId,
      roles: ['event_manager'],
      identityTag,
      basicInfo: {
        phoneNumber,
        englishName,
        chineseName,
        email,
        passwordHash,
        passwordSalt,
        pinHash: passwordHash,
        pinSalt: passwordSalt,
        isPhoneVerified: false
      },
      roleSpecificData: {
        event_manager: {
          organizationId,
          eventId,
          assignedAt: now,
          assignedBy: callerUid
        }
      },
      accountStatus: {
        status: 'active',
        createdAt: now,
        updatedAt: now
      },
      activityData: {
        joinedAt: now,
        lastActiveAt: now,
        participationStatus: 'active'
      }
    };

    // Write user doc under event users collection
    await usersCol.doc(newUserId).set(userDoc);
    console.log('[createEventManager] User document created:', newUserId);

    // Update event document with eventManager
    await eventRef.update({
      eventManager: newUserId,
      'statistics.totalManagers': admin.firestore.FieldValue.increment(1),
      updatedAt: now
    });
    console.log('[createEventManager] Event eventManager field updated');

    // 更新组织的 admins 数组
    const adminEntry = {
      userId: newUserId,
      authUid: newUserId,
      phoneNumber,
      englishName,
      chineseName,
      role: 'event_manager',
      eventId,
      addedAt: now,
      addedBy: callerUid
    };
    
    await orgRef.update({
      admins: admin.firestore.FieldValue.arrayUnion(adminEntry),
      updatedAt: now
    });
    console.log('[createEventManager] Organization admins array updated');

    return {
      success: true,
      userId: newUserId,
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

    const newUserId = `usr_${crypto.randomUUID()}`;
    const now = new Date();

    const userDoc = {
      userId: newUserId,
      authUid: newUserId,
      roles: ['event_manager'],
      identityTag,
      basicInfo: {
        phoneNumber,
        englishName,
        chineseName,
        email,
        passwordHash,
        passwordSalt,
        pinHash: passwordHash,
        pinSalt: passwordSalt,
        isPhoneVerified: false
      },
      identityInfo: identityId ? { identityId } : undefined,
      roleSpecificData: {
        event_manager: {
          organizationId,
          eventId,
          assignedAt: now,
          assignedBy: callerUid
        }
      },
      accountStatus: {
        status: 'active',
        createdAt: now,
        updatedAt: now
      },
      activityData: {
        joinedAt: now,
        lastActiveAt: now,
        participationStatus: 'active'
      }
    };

    // remove undefined keys
    if (!userDoc.identityInfo) delete userDoc.identityInfo;

    await usersCol.doc(newUserId).set(userDoc);
    await eventRef.update({
      eventManager: newUserId,
      'statistics.totalUsers': admin.firestore.FieldValue.increment(1),
      'statistics.totalManagers': admin.firestore.FieldValue.increment(1),
      updatedAt: now
    });

    const adminEntry = {
      userId: newUserId,
      authUid: newUserId,
      phoneNumber,
      englishName,
      chineseName,
      role: 'event_manager',
      eventId,
      addedAt: now,
      addedBy: callerUid
    };
    await orgRef.update({
      admins: admin.firestore.FieldValue.arrayUnion(adminEntry),
      updatedAt: now
    });

    return res.status(200).json({ success: true, userId: newUserId, message: 'Event Manager 创建成功' });
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


// Consolidated Event Manager login callable function
// Accepts either organizationId/eventId (document ids) or orgCode/eventCode (human codes)
// Returns a custom token and metadata for the event manager
exports.loginEventManager = functions.https.onCall(async (data, context) => {
  try {
    console.log('[loginEventManager] Login attempt');

    const actual = data && data.data ? data.data : data || {};
    let { organizationId, eventId, orgCode, eventCode, phoneNumber, password } = actual;

    console.log('[loginEventManager] Received:', { organizationId, eventId, orgCode, eventCode, phoneNumber: phoneNumber ? `${phoneNumber.substring(0,3)}***` : 'missing' });

    // If IDs not provided but codes are, resolve them
    if ((!organizationId || !eventId) && orgCode && eventCode) {
      console.log('[loginEventManager] Resolving organizationId/eventId from codes');
      const orgsSnap = await getDb().collection('organizations')
        .where('orgCode', '==', String(orgCode).toLowerCase())
        .limit(1)
        .get();
      if (orgsSnap.empty) {
        console.log('[loginEventManager] Organization not found for code:', orgCode);
        throw new functions.https.HttpsError('not-found', '找不到该组织');
      }
      organizationId = orgsSnap.docs[0].id;
      console.log('[loginEventManager] Resolved organizationId:', organizationId);

      const eventsSnap = await getDb().collection('organizations').doc(organizationId)
        .collection('events')
        .where('eventCode', '==', String(eventCode))
        .limit(1)
        .get();
      if (eventsSnap.empty) {
        console.log('[loginEventManager] Event not found for code:', eventCode);
        throw new functions.https.HttpsError('not-found', '找不到该活动');
      }
      eventId = eventsSnap.docs[0].id;
      console.log('[loginEventManager] Resolved eventId:', eventId);
    }

    // Validate inputs
    if (!organizationId || !eventId || !phoneNumber || !password) {
      console.log('[loginEventManager] Missing required fields');
      throw new functions.https.HttpsError('invalid-argument', '请填写所有必填字段');
    }

    // find user under the event
    const usersSnap = await getDb().collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users')
      .where('basicInfo.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (usersSnap.empty) {
      console.log('[loginEventManager] User not found for phone:', phoneNumber);
      throw new functions.https.HttpsError('permission-denied', '手机号或密码错误');
    }

    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    console.log('[loginEventManager] User found:', { userId, roles: userData.roles });

    if (!userData.roles || !userData.roles.includes('event_manager')) {
      console.log('[loginEventManager] User is not an event_manager');
      throw new functions.https.HttpsError('permission-denied', '您不是此活动的 Event Manager');
    }

    const passwordSalt = userData.basicInfo?.passwordSalt;
    const storedHash = userData.basicInfo?.passwordHash;
    if (!passwordSalt || !storedHash) {
      console.log('[loginEventManager] Password data missing');
      throw new functions.https.HttpsError('failed-precondition', '密码数据缺失，请联系管理员');
    }

    const inputHash = sha256(password + passwordSalt);
    if (inputHash !== storedHash) {
      console.log('[loginEventManager] Password mismatch');
      throw new functions.https.HttpsError('permission-denied', '手机号或密码错误');
    }

    console.log('[loginEventManager] Password verified');

    let authUid = userData.authUid || userId;
    try {
      await admin.auth().getUser(authUid);
      console.log('[loginEventManager] Auth user exists:', authUid);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        await admin.auth().createUser({ uid: authUid, displayName: userData.basicInfo?.englishName || 'Event Manager' });
        console.log('[loginEventManager] Auth user created:', authUid);
        await getDb().collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(userId)
          .update({ authUid: authUid, 'accountStatus.updatedAt': new Date() });
      } else {
        console.error('[loginEventManager] Auth getUser error:', err);
        throw err;
      }
    }

    const customToken = await admin.auth().createCustomToken(authUid);
    console.log('[loginEventManager] Custom token created');

    await getDb().collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId)
      .update({ 'activityData.lastActiveAt': new Date() });

    return {
      success: true,
      customToken,
      userId,
      organizationId,
      eventId,
      englishName: userData.basicInfo?.englishName || '',
      chineseName: userData.basicInfo?.chineseName || '',
      message: '登录成功'
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('[loginEventManager] Error:', error);
    throw new functions.https.HttpsError('internal', error.message || '登录失败');
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
    const validRoles = ['seller_manager', 'merchant_manager', 'customer_manager', 'seller', 'merchant', 'customer'];
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
    const identityInfo = {
      identityId: `${identityTag.toUpperCase()}_${Date.now()}`,
      identityName: validTag.name['zh-CN'],
      identityNameEn: validTag.name['en'],
      department: department || '未分配'
    };

    // 7. 构建 roleSpecificData
    const roleSpecificData = {};
    
    if (roles.includes('seller_manager')) {
      roleSpecificData.seller_manager = {
        managerId: `SM${Date.now()}`,
        assignedCapital: 0,
        availableCapital: 0,
        allocatedToSellers: 0,
        totalSellersManaged: 0
      };
    }
    
    if (roles.includes('merchant_manager')) {
      roleSpecificData.merchant_manager = {
        managerId: `MM${Date.now()}`,
        totalMerchantsManaged: 0
      };
    }
    
    if (roles.includes('customer_manager')) {
      roleSpecificData.customer_manager = {
        managerId: `CM${Date.now()}`,
        totalCustomersManaged: 0,
        totalSalesAmount: 0
      };
    }
    
    if (roles.includes('seller')) {
      roleSpecificData.seller = {
        sellerId: `SL${Date.now()}`,
        availablePoints: 0,
        currentSalesAmount: 0,
        totalPointsSold: 0
      };
    }
    
    if (roles.includes('merchant')) {
      roleSpecificData.merchant = {
        merchantId: `MR${Date.now()}`,
        monthlyReceivedPoints: 0,
        totalReceivedPoints: 0
      };
    }
    
    if (roles.includes('customer')) {
      roleSpecificData.customer = {
        customerId: `CS${Date.now()}`,
        currentBalance: 0,
        totalPointsPurchased: 0,
        totalPointsConsumed: 0
      };
    }

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
      roleSpecificData: roleSpecificData,
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
        registrationSource: 'event_manager_create',
        operatorUid: 'event_manager',
        notes: `由 Event Manager 创建 - ${roles.join(', ')}`
      }
    };

    // 9. 保存用户文档
    await usersCol.doc(userId).set(userDoc);
    console.log('[createUserByEventManagerHttp] User created:', userId);

    // 10. 更新活动统计
    const updateData = {
      'statistics.totalUsers': admin.firestore.FieldValue.increment(1),
      updatedAt: now
    };

    // 根据角色更新对应的统计
    if (roles.includes('seller_manager')) {
      updateData['statistics.totalSellerManagers'] = admin.firestore.FieldValue.increment(1);
    }
    if (roles.includes('merchant_manager')) {
      updateData['statistics.totalMerchantManagers'] = admin.firestore.FieldValue.increment(1);
    }
    if (roles.includes('customer_manager')) {
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

    // Use batch for atomic operations (max 500 operations per batch)
    const batch = db.batch();
    let operationCount = 0;

    // 1. Delete all users in the event
    const usersSnapshot = await db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users')
      .get();

    console.log(`[deleteEventHttp] Found ${usersSnapshot.size} users to delete`);

    usersSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      operationCount++;
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

    // 5. Update organization data (admins + statistics)
    batch.update(orgRef, {
      'admins': updatedAdmins,
      'statistics.totalUsers': admin.firestore.FieldValue.increment(-usersToDelete),
      'statistics.totalEvents': admin.firestore.FieldValue.increment(-1),
      'statistics.activeEvents': admin.firestore.FieldValue.increment(isActive ? -1 : 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    operationCount++;

    console.log(`[deleteEventHttp] Committing batch with ${operationCount} operations`);

    // Commit all operations atomically
    await batch.commit();

    console.log('[deleteEventHttp] ✅ Delete successful');

    res.status(200).json({
      success: true,
      deletedUsers: usersSnapshot.size,
      deletedMetadata: metadataSnapshot.size,
      removedAdmins: removedAdminsCount,
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
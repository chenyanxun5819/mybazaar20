const admin = require('firebase-admin');
const functions = require('firebase-functions');
const crypto = require('crypto');

function getDb() {
  return admin.firestore();
}

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

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

// ========== Event Manager 管理 ==========

/**
 * 创建 Event Manager（组织活动管理员）
 * 只有 Platform Admin 可以调用
 */
exports.createEventManager = functions.https.onCall(async (data, context) => {
  console.log('[createEventManager] Received request');
  
  const actualData = data.data || data;
  const callerUid = context.auth ? context.auth.uid : actualData.callerUid;
  
  console.log('[createEventManager] Caller UID:', callerUid);
  
  if (!callerUid) {
    throw new functions.https.HttpsError('unauthenticated', '必须登录才能执行此操作');
  }
  
  // ========== 1. 验证权限：调用者必须是 Platform Admin ==========
  try {
    // 方法 1：通过 authUid 查询
    const userQuery = await getDb().collection('users')
      .where('authUid', '==', callerUid)
      .limit(1)
      .get();
    
    let hasPermission = false;
    
    if (!userQuery.empty) {
      const userData = userQuery.docs[0].data();
      console.log('[createEventManager] Found user by authUid:', { 
        docId: userQuery.docs[0].id, 
        roles: userData.roles 
      });
      hasPermission = userData.roles && userData.roles.includes('platform_admin');
    } else {
      // 方法 2：直接通过文档 ID 查询（备用）
      const directDoc = await getDb().collection('users').doc(callerUid).get();
      if (directDoc.exists) {
        const userData = directDoc.data();
        console.log('[createEventManager] Found user by docId:', { 
          docId: directDoc.id, 
          roles: userData.roles 
        });
        hasPermission = userData.roles && userData.roles.includes('platform_admin');
      }
    }
    
    if (!hasPermission) {
      console.log('[createEventManager] Permission denied: User is not platform_admin');
      throw new functions.https.HttpsError('permission-denied', '只有 Platform Admin 可以创建 Event Manager');
    }
    
    console.log('[createEventManager] Permission check passed');
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('[createEventManager] Permission check error:', error);
    throw new functions.https.HttpsError('internal', '权限验证失败: ' + error.message);
  }
  
  // ========== 2. 提取和验证参数 ==========
  const { 
    organizationId, 
    eventId, 
    phoneNumber, 
    password, 
    englishName, 
    chineseName, 
    email,
    identityTag 
  } = actualData;
  
  console.log('[createEventManager] Creating Event Manager:', { 
    organizationId,
    eventId,
    phoneNumber, 
    englishName, 
    chineseName,
    identityTag
  });
  
  // 验证必填字段
  if (!organizationId || !eventId || !phoneNumber || !password || !englishName || !identityTag) {
    throw new functions.https.HttpsError('invalid-argument', '缺少必要字段：organizationId, eventId, phoneNumber, password, englishName, identityTag');
  }
  
  // 验证密码强度
  if (password.length < 8) {
    throw new functions.https.HttpsError('invalid-argument', '密码至少需要8个字符');
  }
  
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new functions.https.HttpsError('invalid-argument', '密码必须包含英文字母和数字');
  }
  
  // 验证身份标签
  const validIdentityTags = ['staff', 'teacher'];
  if (!validIdentityTags.includes(identityTag)) {
    throw new functions.https.HttpsError('invalid-argument', 'Event Manager 必须选择有效的身份标签 (staff 或 teacher)');
  }
  
  // ========== 3. 验证组织和活动是否存在 ==========
  try {
    const orgDoc = await getDb().collection('organizations').doc(organizationId).get();
    if (!orgDoc.exists) {
      throw new functions.https.HttpsError('not-found', '组织不存在');
    }
    
    const eventDoc = await getDb().collection('organizations')
      .doc(organizationId)
      .collection('events')
      .doc(eventId)
      .get();
    
    if (!eventDoc.exists) {
      throw new functions.https.HttpsError('not-found', '活动不存在');
    }
    
    const eventData = eventDoc.data();
    
    // 检查活动是否已有 Event Manager
    if (eventData.eventManager) {
      throw new functions.https.HttpsError('already-exists', '此活动已有 Event Manager，请先移除现有管理员');
    }
    
    console.log('[createEventManager] Organization and Event verified');
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('[createEventManager] Validation error:', error);
    throw new functions.https.HttpsError('internal', '验证组织和活动失败: ' + error.message);
  }
  
  // ========== 4. 检查手机号是否已存在于此活动 ==========
  try {
    const existingUserSnap = await getDb()
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
      .doc(eventId)
      .collection('users')
      .where('basicInfo.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();
    
    if (!existingUserSnap.empty) {
      throw new functions.https.HttpsError('already-exists', '此手机号已在此活动中注册');
    }
    
    console.log('[createEventManager] Phone number is available');
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('[createEventManager] Phone check error:', error);
    throw new functions.https.HttpsError('internal', '检查手机号失败: ' + error.message);
  }
  
  // ========== 5. 生成密码 hash 和 salt ==========
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = sha256(password + passwordSalt);
  
  console.log('[createEventManager] Password hash generated');
  
  // ========== 6. 创建 Firebase Auth 用户 ==========
  const normalizedPhone = phoneNumber.replace(/^0/, '');
  const authUid = `phone_60${normalizedPhone}`;
  
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      uid: authUid,
      displayName: englishName,
      disabled: false
    });
    console.log('[createEventManager] Firebase Auth user created:', authUid);
  } catch (authError) {
    if (authError.code === 'auth/uid-already-exists') {
      // Auth 用户已存在，获取现有用户
      userRecord = await admin.auth().getUser(authUid);
      console.log('[createEventManager] Firebase Auth user already exists:', authUid);
    } else {
      console.error('[createEventManager] Auth creation error:', authError);
      throw new functions.https.HttpsError('internal', '创建认证用户失败: ' + authError.message);
    }
  }
  
  // ========== 7. 构建 identityInfo ==========
  let identityInfo = {};
  const eventManagerId = `EM${Date.now()}`; // 生成唯一 ID
  
  switch (identityTag) {
    case 'staff':
      identityInfo = {
        staffId: eventManagerId,
        position: 'event_manager'
      };
      break;
    case 'teacher':
      identityInfo = {
        teacherId: eventManagerId,
        department: '活动管理'
      };
      break;
  }
  
  // ========== 8. 创建 Firestore 用户文档 ==========
  const userId = authUid; // 使用 authUid 作为文档 ID
  const now = new Date();
  
  const userDocData = {
    authUid: authUid,
    roles: ['event_manager'],
    identityTag: identityTag,
    basicInfo: {
      phoneNumber: phoneNumber,
      englishName: englishName,
      chineseName: chineseName || '',
      email: email || '',
      passwordHash: passwordHash,
      passwordSalt: passwordSalt,
      isPhoneVerified: true
    },
    identityInfo: identityInfo,
    roleSpecificData: {
      event_manager: {
        organizationId: organizationId,
        eventId: eventId,
        assignedAt: now,
        assignedBy: callerUid
      }
    },
    accountStatus: {
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
  };
  
  try {
    await getDb()
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
      .doc(eventId)
      .collection('users')
      .doc(userId)
      .set(userDocData);
    
    console.log('[createEventManager] User document created:', userId);
  } catch (error) {
    console.error('[createEventManager] Firestore creation error:', error);
    throw new functions.https.HttpsError('internal', '创建用户文档失败: ' + error.message);
  }
  
  // ========== 9. 更新组织的 admins 数组 ==========
  try {
    const adminEntry = {
      userId: userId,
      authUid: authUid,
      phoneNumber: phoneNumber,
      englishName: englishName,
      chineseName: chineseName || '',
      role: 'event_manager',
      eventId: eventId,
      addedAt: now,
      addedBy: callerUid
    };
    
    await getDb()
      .collection('organizations')
      .doc(organizationId)
      .update({
        admins: admin.firestore.FieldValue.arrayUnion(adminEntry),
        updatedAt: now
      });
    
    console.log('[createEventManager] Organization admins array updated');
  } catch (error) {
    console.error('[createEventManager] Update admins error:', error);
    throw new functions.https.HttpsError('internal', '更新组织管理员列表失败: ' + error.message);
  }
  
  // ========== 10. 更新活动的 eventManager 字段 ==========
  try {
    await getDb()
      .collection('organizations')
      .doc(organizationId)
      .collection('events')
      .doc(eventId)
      .update({
        eventManager: userId,
        updatedAt: now
      });
    
    console.log('[createEventManager] Event eventManager field updated');
  } catch (error) {
    console.error('[createEventManager] Update eventManager error:', error);
    throw new functions.https.HttpsError('internal', '更新活动管理员字段失败: ' + error.message);
  }
  
  // ========== 11. 返回成功结果 ==========
  console.log('[createEventManager] Event Manager created successfully:', userId);
  
  return {
    success: true,
    userId: userId,
    authUid: authUid,
    eventManagerId: eventManagerId,
    message: 'Event Manager 创建成功'
  };
});
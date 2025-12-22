const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

// ===========================================
// 🔧 辅助函数
// ===========================================

/**
 * SHA256 哈希函数
 */
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * 标准化手机号码
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  let cleaned = String(phoneNumber).replace(/[\s\-\(\)]/g, '');

  // 移除国家代码
  if (cleaned.startsWith('+60')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('60')) {
    cleaned = cleaned.substring(2);
  }

  // 移除前导0
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  return cleaned;
}

/**
 * 生成手机号变体（用于查询）
 */
function getPhoneVariants(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return [];

  return [
    normalized,
    `0${normalized}`,
    `60${normalized}`,
    `+60${normalized}`,
    phoneNumber  // 原始输入
  ];
}

/**
 * 验证OTP Session
 */
async function verifyOtpSession(sessionId, context) {
  const db = admin.firestore();

  // 读取OTP session
  const otpDoc = await db.collection('otp_sessions').doc(sessionId).get();

  if (!otpDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'OTP session不存在');
  }

  const otpData = otpDoc.data();

  // 验证状态
  if (otpData.status !== 'verified') {
    throw new functions.https.HttpsError('permission-denied', 'OTP未验证');
  }

  // 验证所有权（如果有userId）
  if (otpData.userId && context.auth && otpData.userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', '无权使用此OTP session');
  }

  // 检查是否过期
  if (Date.now() > otpData.expiresAt) {
    throw new functions.https.HttpsError('deadline-exceeded', 'OTP session已过期');
  }

  return { otpDoc, otpData };
}

/**
 * 读取Platform Settings
 */
async function getPlatformSettings() {
  const db = admin.firestore();
  const settingsDoc = await db.collection('platform_settings').doc('config').get();

  if (!settingsDoc.exists) {
    console.warn('[getPlatformSettings] ⚠️ platform_settings/config 不存在');
    return null;
  }

  return settingsDoc.data();
}

// ===========================================
// 📝 Customer注册
// ===========================================

/**
 * 创建Customer账户
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织ID
 * @param {string} data.eventId - 活动ID
 * @param {string} data.phoneNumber - 手机号（+60格式）
 * @param {string} data.displayName - 显示名称（昵称）
 * @param {string} data.password - 密码
 * @param {string} [data.email] - 邮箱（可选）
 */
exports.createCustomer = functions.https.onCall(async (data, context) => {
  try {
    const { organizationId, eventId, phoneNumber, displayName, password, email } = data;

    console.log('[createCustomer] 开始创建Customer:', { organizationId, eventId, phoneNumber, displayName });

    // === 验证必填字段 ===
    if (!organizationId || !eventId || !phoneNumber || !displayName || !password) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '缺少必填字段：organizationId, eventId, phoneNumber, displayName, password'
      );
    }

    // === 验证手机号格式 ===
    const phoneRegex = /^\+?60\d{9,10}$/;
    if (!phoneRegex.test(phoneNumber.replace(/[\s\-]/g, ''))) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '手机号格式不正确，应为+60开头的马来西亚号码'
      );
    }

    // === 验证密码长度 ===
    if (password.length < 6) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '密码至少需要6个字符'
      );
    }

    const db = admin.firestore();

    // === 检查手机号是否已在该Event中注册 ===
    const phoneVariants = getPhoneVariants(phoneNumber);
    let existingUser = null;

    for (const variant of phoneVariants) {
      const userQuery = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users')
        .where('identityInfo.phoneNumber', '==', variant)
        .limit(1)
        .get();

      if (!userQuery.empty) {
        existingUser = userQuery.docs[0];
        break;
      }
    }

    if (existingUser) {
      throw new functions.https.HttpsError(
        'already-exists',
        '该手机号已在此活动中注册'
      );
    }

    console.log('[createCustomer] ✅ 手机号验证通过，开始创建账户');

    // === 生成密码哈希 ===
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = sha256(password + passwordSalt);

    // === 生成用户ID ===
    const userId = `customer_${normalizePhoneNumber(phoneNumber)}_${Date.now()}`;

    // === 创建Customer文档 ===
    const customerData = {
      userId,
      roles: ['customer'],

      // 身份信息
      identityInfo: {
        phoneNumber: phoneNumber,
        displayName: displayName,
        email: email || '',
        identityTag: 'public',
        department: 'N/A',
        position: 'Customer'
      },

      // 基本信息（用于登录）
      basicInfo: {
        phoneNumber: phoneNumber,
        englishName: displayName,
        chineseName: displayName,
        email: email || '',
        passwordHash: passwordHash,
        passwordSalt: passwordSalt,
        isPhoneVerified: false
      },

      // Customer特有数据
      customer: {
        // 点数账户
        pointsAccount: {
          availablePoints: 0,
          reservedPoints: 0,
          totalReceived: 0,
          totalSpent: 0,
          totalTransferredOut: 0,
          totalTransferredIn: 0
        },

        // 个人QR Code
        qrCodeData: {
          type: 'CUSTOMER_RECEIVE_POINTS',
          version: '1.0',
          userId: userId,
          eventId: eventId,
          organizationId: organizationId,
          generatedAt: admin.firestore.FieldValue.serverTimestamp()
        },

        // 统计数据
        stats: {
          transactionCount: 0,
          merchantPaymentCount: 0,
          merchantsVisited: [],
          pointCardsRedeemed: 0,
          pointCardsTopupAmount: 0,
          transfersSent: 0,
          transfersReceived: 0,
          lastActivityAt: null
        }
      },

      // 账户状态
      accountStatus: {
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLogin: null
      },

      // 元数据
      metadata: {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: null,
        registrationSource: 'web',
        registeredFrom: 'customer_register_page',
        ipAddress: context.rawRequest?.ip || '',
        isActive: true,
        eventId: eventId,
        organizationId: organizationId
      }
    };

    // === 写入Firestore ===
    await db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId)
      .set(customerData);

    console.log('[createCustomer] ✅ Customer文档创建成功:', userId);

    // === 创建Firebase Auth账户 ===
    try {
      await admin.auth().createUser({
        uid: userId,
        phoneNumber: phoneNumber,
        disabled: false
      });
      console.log('[createCustomer] ✅ Firebase Auth账户创建成功');
    } catch (authError) {
      console.error('[createCustomer] ⚠️ Auth账户创建失败（可能已存在）:', authError.message);
      // 不抛出错误，因为Firestore文档已创建成功
    }

    // === 更新Event统计 ===
    const eventRef = db.collection('organizations').doc(organizationId)
      .collection('events').doc(eventId);

    await eventRef.update({
      'roleStats.customers.count': admin.firestore.FieldValue.increment(1),
      'statistics.totalUsers': admin.firestore.FieldValue.increment(1),
      'statistics.totalCustomers': admin.firestore.FieldValue.increment(1)
    });

    console.log('[createCustomer] ✅ Event统计更新成功');

    return {
      success: true,
      userId: userId,
      message: '注册成功！请使用手机号和密码登录'
    };

  } catch (error) {
    console.error('[createCustomer] ❌ 错误:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      'internal',
      `注册失败：${error.message}`
    );
  }
});

// ===========================================
// 💰 Customer付款给Merchant
// ===========================================

/**
 * Customer付款给Merchant
 * 
 * @param {object} data
 * @param {string} data.merchantId - 商家ID
 * @param {number} data.amount - 付款金额
 * @param {string} [data.otpSessionId] - OTP session ID（如果需要验证）
 */
exports.processCustomerPayment = functions.https.onCall(async (data, context) => {
  // ✅ 详细的诊断日志
  console.log('[processCustomerPayment] ========== 开始处理 ==========');
  console.log('[processCustomerPayment] typeof data:', typeof data);
  console.log('[processCustomerPayment] data === null:', data === null);
  console.log('[processCustomerPayment] data === undefined:', data === undefined);

  // ✅ 安全地检查 data
  if (data) {
    console.log('[processCustomerPayment] data 的 keys:', Object.keys(data));
    console.log('[processCustomerPayment] 参数检查:', {
      hasMerchantId: 'merchantId' in data,
      hasAmount: 'amount' in data,
      hasOtpSessionId: 'otpSessionId' in data,
      hasOrganizationId: 'organizationId' in data,
      hasEventId: 'eventId' in data
    });

    // ✅ 安全地记录参数值
    const requestData = data?.data || data || {};
    console.log('[processCustomerPayment] 参数值:', {
      merchantId: requestData.merchantId || 'missing',
      amount: requestData.amount || 'missing',
      otpSessionId: requestData.otpSessionId ? 'exists' : 'missing',
      organizationId: requestData.organizationId || 'missing',
      eventId: requestData.eventId || 'missing'
    });
  } else {
    console.error('[processCustomerPayment] ❌ data 是 null 或 undefined！');
  }

  // ✅ 检查 context.auth
  console.log('[processCustomerPayment] context.auth:', context.auth ? {
    uid: context.auth.uid,
    hasToken: !!context.auth.token
  } : 'null');

  try {
    // === 验证身份（支援 OTP 回退）===
    // ✅ Firebase httpsCallable 将参数包装在 data.data 中
    const requestData = data?.data || data || {};
    const { merchantId, amount, otpSessionId, organizationId, eventId } = requestData;
    let customerId = context.auth?.uid || null;

    console.log('[processCustomerPayment] ✅ 提取的参数:', {
      merchantId: merchantId || 'missing',
      amount: amount || 'missing',
      organizationId: organizationId || 'missing',
      eventId: eventId || 'missing',
      otpSessionId: otpSessionId || 'missing'
    });

    // ✅ 验证必要参数
    if (!merchantId) {
      console.error('[processCustomerPayment] ❌ merchantId 缺失');
      throw new functions.https.HttpsError('invalid-argument', '缺少商家ID');
    }

    if (!amount || amount <= 0) {
      console.error('[processCustomerPayment] ❌ amount 无效:', amount);
      throw new functions.https.HttpsError('invalid-argument', '金额无效');
    }

    if (!organizationId || !eventId) {
      console.error('[processCustomerPayment] ❌ organizationId 或 eventId 缺失');
      throw new functions.https.HttpsError('invalid-argument', '缺少组织或活动信息');
    }

    console.log('[processCustomerPayment] ✅ 参数验证通过');
    console.log('[processCustomerPayment] merchantId:', merchantId);
    console.log('[processCustomerPayment] amount:', amount);
    console.log('[processCustomerPayment] organizationId:', organizationId);
    console.log('[processCustomerPayment] eventId:', eventId);

    // === 身份验证 ===
    if (!customerId) {
      // 若无 auth 但提供了 OTP session，嘗試以驗證過的 OTP 作為身份來源
      if (!otpSessionId) {
        console.error('[processCustomerPayment] ❌ 未通过身份验证：context.auth 缺失且未提供 otpSessionId');
        throw new functions.https.HttpsError('unauthenticated', '请先登录');
      }

      console.log('[processCustomerPayment] 尝试使用 OTP 验证...');
      const { otpDoc, otpData } = await verifyOtpSession(otpSessionId, context);

      if (otpData.scenario !== 'customerPayment') {
        throw new functions.https.HttpsError('invalid-argument', 'OTP场景不匹配');
      }

      customerId = otpData.userId;
      console.log('[processCustomerPayment] ✅ 通过 OTP 验证，customerId:', customerId);
    } else {
      console.log('[processCustomerPayment] ✅ 通过 context.auth 验证，customerId:', customerId);
    }

    // ... 其余代码保持不变
    // 當 context.auth 缺失時，記錄額外線索
    if (!context.auth) {
      console.warn('[processCustomerPayment] ⚠️ context.auth 缺失');
      console.warn('[processCustomerPayment] ⚠️ rawRequest headers present:', !!context.rawRequest?.headers);
    } else {
      console.log('[processCustomerPayment] ✅ context.auth 已取得:', context.auth.uid);
    }

    // 先嘗試用前端傳入的 idToken 驗證身份
    if (!customerId && idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded?.uid) {
          customerId = decoded.uid;
          console.log('[processCustomerPayment] 使用 idToken 驗證身份，customerId:', customerId);
        }
      } catch (e) {
        console.warn('[processCustomerPayment] idToken 驗證失敗:', e?.message || e);
      }
    }

    if (!customerId) {
      // 若無 auth 但提供了 OTP session，嘗試以驗證過的 OTP 作為身份來源
      if (!otpSessionId) {
        console.error('[processCustomerPayment] ❌ 未通過身份驗證：context.auth 缺失且未提供 otpSessionId');
        console.error('[processCustomerPayment] ❌ 建議檢查前端是否在呼叫前確實登入並刷新 ID token');
        throw new functions.https.HttpsError('unauthenticated', '请先登录');
      }
      const { otpDoc, otpData } = await verifyOtpSession(otpSessionId, context);
      if (otpData.scenario !== 'customerPayment') {
        throw new functions.https.HttpsError('invalid-argument', 'OTP场景不匹配');
      }
      customerId = otpData.userId;
      // 不在此處刪除 OTP；統一在後續驗證通過流程刪除
      console.log('[processCustomerPayment] 使用 OTP 回退身份驗證，customerId:', customerId);
    }

    console.log('[processCustomerPayment] 开始处理付款:', { customerId, merchantId, amount });

    // === 验证参数 ===
    if (!merchantId || !amount) {
      throw new functions.https.HttpsError('invalid-argument', '缺少必填字段');
    }

    if (amount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', '金额必须大于0');
    }

    const db = admin.firestore();

    // === 读取Platform Settings检查是否需要OTP ===
    const settings = await getPlatformSettings();
    const otpRequired = settings?.otpRequired?.customerPayment || false;

    // === 如果需要OTP，验证之 ===
    if (otpRequired) {
      if (!otpSessionId) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          '此操作需要OTP验证，请先发送验证码'
        );
      }

      // 验证OTP
      const { otpDoc, otpData } = await verifyOtpSession(otpSessionId, context);

      // 验证场景匹配
      if (otpData.scenario !== 'customerPayment') {
        throw new functions.https.HttpsError('invalid-argument', 'OTP场景不匹配');
      }

      // 验证用户匹配
      if (otpData.userId !== customerId) {
        throw new functions.https.HttpsError('permission-denied', '无权使用此OTP');
      }

      console.log('[processCustomerPayment] ✅ OTP验证通过');

      // 删除已使用的OTP session
      await otpDoc.ref.delete();
    }


    // === 使用Transaction执行付款 ===
    const result = await db.runTransaction(async (transaction) => {
      // 读取Customer文档
      const customerRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(customerId);

      const customerDoc = await transaction.get(customerRef);

      if (!customerDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Customer不存在');
      }

      const customerData = customerDoc.data();
      const availablePoints = customerData.customer?.pointsAccount?.availablePoints || 0;

      // 检查余额
      if (availablePoints < amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `余额不足。当前余额：${availablePoints}点，需要：${amount}点`
        );
      }

      // 读取Merchant文档
      const merchantRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('merchants').doc(merchantId);

      const merchantDoc = await transaction.get(merchantRef);

      if (!merchantDoc.exists) {
        throw new functions.https.HttpsError('not-found', '商家不存在');
      }

      const merchantData = merchantDoc.data();

      // 检查商家是否营业
      if (!merchantData.operationStatus?.isActive) {
        throw new functions.https.HttpsError('failed-precondition', '商家暂停营业');
      }

      // 扣除Customer点数
      transaction.update(customerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(-amount),
        'customer.pointsAccount.totalSpent': admin.firestore.FieldValue.increment(amount),
        'customer.stats.transactionCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.merchantPaymentCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 添加到访问过的商家列表（如果还没有）
      const merchantsVisited = customerData.customer?.stats?.merchantsVisited || [];
      if (!merchantsVisited.includes(merchantId)) {
        transaction.update(customerRef, {
          'customer.stats.merchantsVisited': admin.firestore.FieldValue.arrayUnion(merchantId)
        });
      }

      // 增加Merchant收入
      transaction.update(merchantRef, {
        'revenueStats.totalRevenue': admin.firestore.FieldValue.increment(amount),
        'revenueStats.todayRevenue': admin.firestore.FieldValue.increment(amount),
        'revenueStats.transactionCount': admin.firestore.FieldValue.increment(1),
        'revenueStats.todayTransactionCount': admin.firestore.FieldValue.increment(1),
        'revenueStats.lastTransactionAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 创建交易记录
      const transactionId = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('transactions').doc().id;

      const transactionData = {
        transactionId,
        eventId,
        organizationId,
        transactionType: 'customer_to_merchant',

        // 交易双方
        customerId,
        customerPhone: customerData.basicInfo?.phoneNumber || '',
        customerName: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName || '',
        merchantId,
        merchantName: merchantData.stallName || '',

        // 金额和状态
        amount,
        status: 'completed',
        paymentMethod: 'POINTS',

        // OTP验证信息
        otpVerified: !!otpSessionId,
        otpSessionId: otpSessionId || null,

        // 时间戳
        timestamp: admin.firestore.FieldValue.serverTimestamp(),

        // 元数据
        metadata: {
          deviceInfo: context.rawRequest?.headers?.['user-agent'] || '',
          ipAddress: context.rawRequest?.ip || ''
        }
      };

      const transactionRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('transactions').doc(transactionId);

      transaction.set(transactionRef, transactionData);

      return {
        transactionId,
        remainingBalance: availablePoints - amount
      };
    });

    console.log('[processCustomerPayment] ✅ 付款成功:', result);

    return {
      success: true,
      transactionId: result.transactionId,
      remainingBalance: result.remainingBalance,
      message: '付款成功'
    };

  } catch (error) {
    console.error('[processCustomerPayment] ❌ 错误:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    // 將未知錯誤包裝為 internal 並附帶訊息
    throw new functions.https.HttpsError('internal', `付款失败：${error && error.message ? error.message : String(error)}`);
  }
});

// ===========================================
// 🔄 Customer转让点数
// ===========================================

/**
 * Customer转让点数给其他Customer
 * 
 * @param {object} data
 * @param {string} data.toPhoneNumber - 接收方手机号
 * @param {number} data.amount - 转让金额
 * @param {string} [data.otpSessionId] - OTP session ID（如果需要验证）
 */
exports.transferPoints = functions.https.onCall(async (data, context) => {
  try {
    // === 验证身份 ===
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', '请先登录');
    }

    const { toPhoneNumber, amount, otpSessionId } = data;
    const fromUserId = context.auth.uid;

    console.log('[transferPoints] 开始转让点数:', { fromUserId, toPhoneNumber, amount });

    // === 验证参数 ===
    if (!toPhoneNumber || !amount) {
      throw new functions.https.HttpsError('invalid-argument', '缺少必填字段');
    }

    if (amount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', '金额必须大于0');
    }

    const db = admin.firestore();

    // === 获取组织和活动信息 ===
    const organizationId = context.auth.token.organizationId;
    const eventId = context.auth.token.eventId;

    if (!organizationId || !eventId) {
      throw new functions.https.HttpsError('failed-precondition', '缺少组织或活动信息');
    }

    // === 查询接收方Customer ===
    const phoneVariants = getPhoneVariants(toPhoneNumber);
    let toCustomerDoc = null;
    let toCustomerData = null;
    let toUserId = null;

    for (const variant of phoneVariants) {
      const userQuery = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users')
        .where('identityInfo.phoneNumber', '==', variant)
        .where('roles', 'array-contains', 'customer')
        .limit(1)
        .get();

      if (!userQuery.empty) {
        toCustomerDoc = userQuery.docs[0];
        toCustomerData = toCustomerDoc.data();
        toUserId = toCustomerDoc.id;
        break;
      }
    }

    if (!toCustomerDoc) {
      throw new functions.https.HttpsError(
        'not-found',
        '接收方不存在或不是Customer'
      );
    }

    // 不能转给自己
    if (toUserId === fromUserId) {
      throw new functions.https.HttpsError('invalid-argument', '不能转给自己');
    }

    console.log('[transferPoints] ✅ 接收方找到:', toUserId);

    // === 读取Platform Settings检查是否需要OTP ===
    const settings = await getPlatformSettings();
    const otpRequired = settings?.otpRequired?.customerTransfer || false;

    // === 如果需要OTP，验证之 ===
    if (otpRequired) {
      if (!otpSessionId) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          '此操作需要OTP验证，请先发送验证码'
        );
      }

      const { otpDoc, otpData } = await verifyOtpSession(otpSessionId, context);

      if (otpData.scenario !== 'customerTransfer') {
        throw new functions.https.HttpsError('invalid-argument', 'OTP场景不匹配');
      }

      if (otpData.userId !== fromUserId) {
        throw new functions.https.HttpsError('permission-denied', '无权使用此OTP');
      }

      console.log('[transferPoints] ✅ OTP验证通过');
      await otpDoc.ref.delete();
    }

    // === 使用Transaction执行转让 ===
    const result = await db.runTransaction(async (transaction) => {
      // 读取转出方
      const fromCustomerRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(fromUserId);

      const fromCustomerDoc = await transaction.get(fromCustomerRef);

      if (!fromCustomerDoc.exists) {
        throw new functions.https.HttpsError('not-found', '转出方不存在');
      }

      const fromCustomerData = fromCustomerDoc.data();
      const availablePoints = fromCustomerData.customer?.pointsAccount?.availablePoints || 0;

      // 检查余额
      if (availablePoints < amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `余额不足。当前余额：${availablePoints}点`
        );
      }

      const toCustomerRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(toUserId);

      // 扣除转出方点数
      transaction.update(fromCustomerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(-amount),
        'customer.pointsAccount.totalTransferredOut': admin.firestore.FieldValue.increment(amount),
        'customer.stats.transfersSent': admin.firestore.FieldValue.increment(1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 增加接收方点数
      transaction.update(toCustomerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(amount),
        'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(amount),
        'customer.pointsAccount.totalTransferredIn': admin.firestore.FieldValue.increment(amount),
        'customer.stats.transfersReceived': admin.firestore.FieldValue.increment(1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 创建交易记录
      const transactionId = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('transactions').doc().id;

      const transactionData = {
        transactionId,
        eventId,
        organizationId,
        transactionType: 'customer_transfer',

        // 转出方
        fromUser: {
          userId: fromUserId,
          userName: fromCustomerData.identityInfo?.displayName || '',
          phone: fromCustomerData.identityInfo?.phoneNumber || ''
        },

        // 接收方
        toUser: {
          userId: toUserId,
          userName: toCustomerData.identityInfo?.displayName || '',
          phone: toCustomerData.identityInfo?.phoneNumber || ''
        },

        // 金额和状态
        amount,
        status: 'completed',

        // OTP验证信息
        otpVerified: !!otpSessionId,
        otpSessionId: otpSessionId || null,

        // 时间戳
        timestamp: admin.firestore.FieldValue.serverTimestamp(),

        // 元数据
        metadata: {
          deviceInfo: context.rawRequest?.headers?.['user-agent'] || '',
          ipAddress: context.rawRequest?.ip || ''
        }
      };

      const transactionRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('transactions').doc(transactionId);

      transaction.set(transactionRef, transactionData);

      return {
        transactionId,
        remainingBalance: availablePoints - amount
      };
    });

    console.log('[transferPoints] ✅ 转让成功:', result);

    return {
      success: true,
      transactionId: result.transactionId,
      remainingBalance: result.remainingBalance,
      recipientName: toCustomerData.identityInfo?.displayName || '',
      message: '转让成功'
    };

  } catch (error) {
    console.error('[transferPoints] ❌ 错误:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError('internal', `转让失败：${error.message}`);
  }
});

// ===========================================
// 🎫 点数卡充值到Customer账户
// ===========================================

/**
 * Customer扫点数卡充值到账户
 * 
 * @param {object} data
 * @param {string} data.cardId - 点数卡ID
 */
exports.topupFromPointCard = functions.https.onCall(async (data, context) => {
  try {
    // === 验证身份 ===
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', '请先登录');
    }

    const { cardId } = data;
    const customerId = context.auth.uid;

    console.log('[topupFromPointCard] 开始点数卡充值:', { customerId, cardId });

    // === 验证参数 ===
    if (!cardId) {
      throw new functions.https.HttpsError('invalid-argument', '缺少点数卡ID');
    }

    const db = admin.firestore();

    // === 获取组织和活动信息 ===
    const organizationId = context.auth.token.organizationId;
    const eventId = context.auth.token.eventId;

    if (!organizationId || !eventId) {
      throw new functions.https.HttpsError('failed-precondition', '缺少组织或活动信息');
    }

    // === 使用Transaction执行充值 ===
    const result = await db.runTransaction(async (transaction) => {
      // 读取点数卡
      const cardRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('pointCards').doc(cardId);

      const cardDoc = await transaction.get(cardRef);

      if (!cardDoc.exists) {
        throw new functions.https.HttpsError('not-found', '点数卡不存在');
      }

      const cardData = cardDoc.data();

      // 验证卡片状态
      if (!cardData.status?.isActive) {
        throw new functions.https.HttpsError('failed-precondition', '点数卡已失效');
      }

      if (cardData.status?.isDestroyed) {
        throw new functions.https.HttpsError('failed-precondition', '点数卡已被使用');
      }

      if (cardData.status?.isExpired) {
        throw new functions.https.HttpsError('failed-precondition', '点数卡已过期');
      }

      const currentBalance = cardData.balance?.current || 0;

      if (currentBalance <= 0) {
        throw new functions.https.HttpsError('failed-precondition', '点数卡余额为零');
      }

      // 读取Customer
      const customerRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(customerId);

      const customerDoc = await transaction.get(customerRef);

      if (!customerDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Customer不存在');
      }

      // 将卡片余额转入Customer账户
      transaction.update(customerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(currentBalance),
        'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(currentBalance),
        'customer.stats.pointCardsRedeemed': admin.firestore.FieldValue.increment(1),
        'customer.stats.pointCardsTopupAmount': admin.firestore.FieldValue.increment(currentBalance),
        'customer.stats.transactionCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 销毁卡片
      transaction.update(cardRef, {
        'balance.current': 0,
        'status.isActive': false,
        'status.isDestroyed': true,
        'status.isEmpty': true,
        'status.destroyedAt': admin.firestore.FieldValue.serverTimestamp(),
        'status.destroyedBy': {
          userId: customerId,
          reason: 'customer_topup'
        }
      });

      // 创建交易记录
      const transactionId = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('transactions').doc().id;

      const customerData = customerDoc.data();

      const transactionData = {
        transactionId,
        eventId,
        organizationId,
        transactionType: 'point_card_topup',

        // 点数卡信息
        cardId,
        cardNumber: cardData.cardNumber || '',

        // Customer信息
        customerId,
        customerName: customerData.identityInfo?.displayName || '',

        // 金额和状态
        amount: currentBalance,
        cardDestroyed: true,
        status: 'completed',

        // 时间戳
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

      const transactionRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('transactions').doc(transactionId);

      transaction.set(transactionRef, transactionData);

      return {
        transactionId,
        amount: currentBalance
      };
    });

    console.log('[topupFromPointCard] ✅ 充值成功:', result);

    return {
      success: true,
      transactionId: result.transactionId,
      amount: result.amount,
      message: '充值成功'
    };

  } catch (error) {
    console.error('[topupFromPointCard] ❌ 错误:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError('internal', `充值失败：${error.message}`);
  }
});

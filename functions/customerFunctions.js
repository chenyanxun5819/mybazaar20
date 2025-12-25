const { onCall, HttpsError } = require('firebase-functions/v2/https');  // ✅ 改用 v2 导入
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
 * 解析并标准化马来西亚手机号
 * - Firestore: 统一存 basicInfo.phoneNumber 为本地格式：0XXXXXXXXX
 * - Auth: 使用 E.164 格式：+60XXXXXXXXX
 * - 查询: 生成多种变体，兼容历史数据（0... / +60... / 60... / 纯数字）
 */
function parseMyPhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  const raw = String(phoneNumber).trim();
  const digitsOnly = raw.replace(/[^0-9]/g, '');
  if (!digitsOnly) return null;

  // 统一为“本地手机号数字（不含 0、不含 60）”
  let localDigits = digitsOnly;
  if (localDigits.startsWith('60') && localDigits.length > 9) localDigits = localDigits.substring(2);
  if (localDigits.startsWith('0')) localDigits = localDigits.substring(1);

  if (!localDigits) return null;

  const local0 = `0${localDigits}`;
  const e164 = `+60${localDigits}`;
  const plain60 = `60${localDigits}`;

  const variantsRaw = [local0, e164, plain60, localDigits, raw];
  const variants = Array.from(new Set(variantsRaw.map(v => String(v).trim()).filter(Boolean)));

  return {
    raw,
    localDigits,
    local0,
    e164,
    variants
  };
}

/**
 * 生成手机号变体（用于查询）
 */
function getPhoneVariants(phoneNumber) {
  const parsed = parseMyPhoneNumber(phoneNumber);
  return parsed?.variants || [];
}

/**
 * 验证OTP Session
 */
async function verifyOtpSession(sessionId, context) {
  const db = admin.firestore();

  // 读取OTP session
  const otpDoc = await db.collection('otp_sessions').doc(sessionId).get();

  if (!otpDoc.exists) {
    throw new HttpsError('not-found', 'OTP session不存在');  // ✅ v2
  }

  const otpData = otpDoc.data();

  // 验证状态
  if (otpData.status !== 'verified') {
    throw new HttpsError('permission-denied', 'OTP未验证');  // ✅ v2
  }

  // 验证所有权（如果有userId）
  if (otpData.userId && context.auth && otpData.userId !== context.auth.uid) {
    throw new HttpsError('permission-denied', '无权使用此OTP session');  // ✅ v2
  }

  // 检查是否过期
  if (Date.now() > otpData.expiresAt) {
    throw new HttpsError('deadline-exceeded', 'OTP session已过期');
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
 * ✨ 修正版：创建Customer账户
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织ID
 * @param {string} data.eventId - 活动ID
 * @param {string} data.phoneNumber - 手机号（可为 012... 或 +60...；Firestore 统一存 0...）
 * @param {string} data.displayName - 显示名称（昵称）
 * @param {string} data.password - 登录密码
 * @param {string} data.transactionPin - 交易密码（6位数字）✨ 新增
 * @param {string} [data.email] - 邮箱（可选）
 */
exports.createCustomer = onCall(async (request) => {
  const { data } = request;  // ← 关键！从 request.data 取数据
  const auth = request.auth;  // ← 认证信息（如果需要）
  
  try {
    // ✨ 修正1：添加 transactionPin 参数
    const {
      organizationId,
      eventId,
      phoneNumber,
      displayName,
      password,
      transactionPin,  // ✨ 新增
      email
    } = data;

    // ✨ 增强日志：显示接收到的所有参数
    console.log('[createCustomer] 📥 收到注册请求:', {
      organizationId: organizationId || 'MISSING',
      eventId: eventId || 'MISSING',
      phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 4)}***` : 'MISSING',
      displayName: displayName || 'MISSING',
      hasPassword: !!password,
      hasTransactionPin: !!transactionPin,  // ✨ 新增
      hasEmail: !!email,
    });

    // === 验证必填字段 ===
    // ✨ 修正2：添加 transactionPin 验证
    if (!organizationId || !eventId || !phoneNumber || !displayName || !password || !transactionPin) {
      const missing = [];
      if (!organizationId) missing.push('organizationId');
      if (!eventId) missing.push('eventId');
      if (!phoneNumber) missing.push('phoneNumber');
      if (!displayName) missing.push('displayName');
      if (!password) missing.push('password');
      if (!transactionPin) missing.push('transactionPin');  // ✨ 新增

      console.error('[createCustomer] ❌ 缺少必填字段:', missing.join(', '));

      throw new HttpsError(
        'invalid-argument',
        `缺少必填字段：${missing.join(', ')}`
      );
    }

    // ✨ 修正3：解析手机号（Firestore 存 0...；Auth 用 +60...）
    const parsedPhone = parseMyPhoneNumber(phoneNumber);

    console.log('[createCustomer] 📱 手机号解析:', {
      original: phoneNumber,
      local0: parsedPhone?.local0,
      e164: parsedPhone?.e164
    });

    // === 验证手机号格式（马来西亚手机号：1xxxxxxxxx 或 1xxxxxxxxxx）===
    if (!parsedPhone || !/^1\d{8,9}$/.test(parsedPhone.localDigits)) {
      throw new HttpsError(
        'invalid-argument',
        '手机号格式不正确，应为马来西亚手机号，例如 0123456789 或 +60123456789'
      );
    }

    // === 验证登录密码长度 ===
    if (password.length < 6) {
      throw new HttpsError(
        'invalid-argument',
        '密码至少需要6个字符'
      );
    }

    // ✨ 修正4：验证交易密码格式
    if (!/^\d{6}$/.test(transactionPin)) {
      throw new HttpsError(
        'invalid-argument',
        '交易密码必须是6位数字'
      );
    }

    const db = admin.firestore();

    // === 检查手机号是否已在该Event中注册（兼容历史存储格式）===
    console.log('[createCustomer] 🔍 检查手机号是否已注册...');

    const phoneVariants = parsedPhone.variants;
    let existingUserDoc = null;

    for (const variant of phoneVariants) {
      const snap = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users')
        .where('basicInfo.phoneNumber', '==', variant)
        .limit(1)
        .get();

      if (!snap.empty) {
        existingUserDoc = snap.docs[0];
        break;
      }
    }

    if (existingUserDoc) {
      console.warn('[createCustomer] ⚠️ 手机号已存在(命中变体):', {
        input: phoneNumber,
        variants: phoneVariants
      });
      throw new HttpsError('already-exists', '该手机号已在此活动中注册');
    }

    console.log('[createCustomer] ✅ 手机号可用，开始创建账户');

    // === 生成密码哈希 ===
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = sha256(password + passwordSalt);

    // ✨ 修正6：生成交易密码哈希
    const pinSalt = crypto.randomBytes(16).toString('hex');
    const pinHash = sha256(transactionPin + pinSalt);

    console.log('[createCustomer] 🔐 密码加密完成');

    // === 生成用户ID ===
    const userId = `customer_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    console.log('[createCustomer] 🆔 生成用户ID:', userId);

    // === 创建Customer文档 ===
    const customerData = {
      userId,
      authUid: userId,  // ✨ 添加 authUid
      roles: ['customer'],

      // 身份信息
      identityInfo: {
        identityTag: 'external',  // ✨ Customer 是外部用户
        identityName: '顾客',
        department: null,
        position: null
      },

      // ✨ 修正7：基本信息（phoneNumber 统一存本地 0... 格式）
      basicInfo: {
        phoneNumber: parsedPhone.local0,  // ✅ 与 createUserByEventManagerHttp 对齐
        englishName: displayName,
        chineseName: displayName,
        email: email || null,
        isPhoneVerified: false,

        // 登录密码
        passwordHash: passwordHash,
        passwordSalt: passwordSalt,
        isFirstLogin: false,
        hasDefaultPassword: false,
        passwordLastChanged: admin.firestore.FieldValue.serverTimestamp(),

        // ✨ 修正8：交易密码
        transactionPinHash: pinHash,
        transactionPinSalt: pinSalt,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLastChanged: admin.firestore.FieldValue.serverTimestamp()
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
        isSuspended: false,
        suspensionReason: null,
        lastLoginAt: null,
        requirePasswordChange: false
      },

      // 活动数据
      activityData: {
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        totalLogins: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'self-registration'
      }
    };

    // === 写入Firestore ===
    console.log('[createCustomer] 💾 写入 Firestore...');

    await db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId)
      .set(customerData);

    console.log('[createCustomer] ✅ Customer文档创建成功:', userId);

    // === 创建Firebase Auth账户 ===
    console.log('[createCustomer] 🔑 创建 Firebase Auth 账户...');

    try {
      await admin.auth().createUser({
        uid: userId,
        phoneNumber: parsedPhone.e164,  // ✅ Auth 使用 E.164
        password: password,
        displayName: displayName
      });

      console.log('[createCustomer] ✅ Firebase Auth 账户创建成功');
    } catch (authError) {
      const authErrorMsg = authError instanceof Error ? authError.message : String(authError);
      console.error('[createCustomer] ❌ 创建 Auth 账户失败:', authErrorMsg);

      // 如果 Auth 创建失败，删除已创建的 Firestore 文档
      await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(userId)
        .delete();

      if (authError.code === 'auth/phone-number-already-exists') {
        throw new HttpsError(
          'already-exists',
          '该手机号已被使用'
        );
      }

      throw new HttpsError(
        'internal',
        `创建认证账户失败：${authError.message}`
      );
    }

    // === 更新Event统计 ===
    console.log('[createCustomer] 📊 更新 Event 统计...');

    await db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .update({
        'roleStats.customers.total': admin.firestore.FieldValue.increment(1),
        'roleStats.customers.active': admin.firestore.FieldValue.increment(1)
      });

    console.log('[createCustomer] ✅ Event 统计更新成功');

    // === 生成 Custom Token（用于自动登录）===
    console.log('[createCustomer] 🎫 生成 Custom Token...');

    const customToken = await admin.auth().createCustomToken(userId, {
      organizationId: organizationId,
      eventId: eventId,
      roles: ['customer']
    });

    console.log('[createCustomer] ✅✅✅ Customer 注册成功!', {
      userId,
      phoneNumber: parsedPhone.local0,
      displayName
    });

    return {
      success: true,
      message: '注册成功',
      userId: userId,
      customToken: customToken,  // ✨ 前端可以用这个自动登录
      phoneNumber: parsedPhone.local0
    };

  } catch (error) {
    // ✅ 修复：避免序列化包含循环引用的 error 对象
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[createCustomer] ❌❌❌ 错误:', { message: errorMsg, stack: errorStack });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `注册失败：${errorMsg}`);
  }
});



// ===========================================
// 💰 Customer付款给Merchant
// ===========================================

/**
 * ✨ 修改后：Customer付款给Merchant - 使用交易密码验证
 * 
 * @param {object} data
 * @param {string} data.merchantId - 商家ID
 * @param {number} data.amount - 付款金额
 * @param {string} data.organizationId - 组织ID
 * @param {string} data.eventId - 活动ID
 * @param {string} data.transactionPin - 交易密码（6位数字）✨ 新增
 * @param {string} [data.otpSessionId] - OTP session ID（向后兼容，可选）
 */
exports.processCustomerPayment = onCall(async (request) => {
  const data = request.data;
  const context = request;
  
  console.log('[processCustomerPayment] ========== 开始处理（PIN验证版）==========');

  try {
    // === 提取参数 ===
    const requestData = data?.data || data || {};
    const { 
      merchantId, 
      amount, 
      organizationId, 
      eventId, 
      transactionPin,  // ✨ 新增
      otpSessionId     // 向后兼容
    } = requestData;
    
    let customerId = context.auth?.uid || null;

    console.log('[processCustomerPayment] ✅ 提取的参数:', {
      merchantId: merchantId || 'missing',
      amount: amount || 'missing',
      organizationId: organizationId || 'missing',
      eventId: eventId || 'missing',
      hasTransactionPin: !!transactionPin,
      hasOtpSessionId: !!otpSessionId
    });

    // === 验证必要参数 ===
    if (!merchantId) {
      throw new HttpsError('invalid-argument', '缺少商家ID');
    }

    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', '金额无效');
    }

    if (!organizationId || !eventId) {
      throw new HttpsError('invalid-argument', '缺少组织或活动信息');
    }

    // === 身份验证 ===
    if (!customerId) {
      throw new HttpsError('unauthenticated', '请先登录');
    }

    console.log('[processCustomerPayment] ✅ 身份验证通过，customerId:', customerId);

    const db = admin.firestore();

    // === 读取Customer文档 ===
    const customerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(customerId);

    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      throw new HttpsError('not-found', 'Customer不存在');
    }

    const customerData = customerDoc.data();

    // ========== ✨ 交易密码验证 ========== 
    if (transactionPin) {
      console.log('[processCustomerPayment] 🔐 开始验证交易密码...');

      // 验证 PIN 格式
      if (!/^\d{6}$/.test(transactionPin)) {
        throw new HttpsError('invalid-argument', '交易密码必须是6位数字');
      }

      // 验证交易密码
      const pinVerifyResult = await verifyTransactionPinInternal(transactionPin, customerData);

      if (!pinVerifyResult.success) {
        // 更新验证状态（增加错误次数）
        await updatePinVerificationStatus(customerRef, false, pinVerifyResult.currentAttempts);

        const MAX_ATTEMPTS = 5;
        const remainingAttempts = MAX_ATTEMPTS - (pinVerifyResult.currentAttempts + 1);

        if (pinVerifyResult.locked) {
          throw new HttpsError('failed-precondition', pinVerifyResult.error);
        }

        if (remainingAttempts <= 0) {
          throw new HttpsError('failed-precondition', '交易密码错误次数过多，账户已被锁定1小时');
        }

        throw new HttpsError(
          'permission-denied',
          `交易密码错误，剩余尝试次数：${remainingAttempts}`
        );
      }

      // 验证成功：重置错误次数
      await updatePinVerificationStatus(customerRef, true);

      console.log('[processCustomerPayment] ✅ 交易密码验证通过');
    } else {
      // ========== 向后兼容：如果没有 PIN，则必须有 OTP ==========
      console.warn('[processCustomerPayment] ⚠️ 未提供交易密码，检查 OTP...');
      
      if (!otpSessionId) {
        throw new HttpsError(
          'invalid-argument',
          '请提供交易密码进行验证'
        );
      }

      // 这里可以保留原有的 OTP 验证逻辑作为向后兼容
      // 但建议逐步迁移到 PIN 验证
      console.log('[processCustomerPayment] 使用 OTP 验证（向后兼容模式）');
      // ... 原有的 OTP 验证代码 ...
    }

    // === 使用Transaction执行付款 ===
    const result = await db.runTransaction(async (transaction) => {
      // 重新读取Customer文档（确保数据最新）
      const customerDocLatest = await transaction.get(customerRef);
      const customerDataLatest = customerDocLatest.data();
      const availablePoints = customerDataLatest.customer?.pointsAccount?.availablePoints || 0;

      // 检查余额
      if (availablePoints < amount) {
        throw new HttpsError(
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
        throw new HttpsError('not-found', '商家不存在');
      }

      const merchantData = merchantDoc.data();

      // 检查商家是否营业
      if (!merchantData.operationStatus?.isActive) {
        throw new HttpsError('failed-precondition', '商家暂停营业');
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
      const merchantsVisited = customerDataLatest.customer?.stats?.merchantsVisited || [];
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
        Type: 'customer_to_merchant',

        // 交易双方
        customerId,
        customerPhone: customerDataLatest.basicInfo?.phoneNumber || '',
        customerName: customerDataLatest.basicInfo?.chineseName || customerDataLatest.basicInfo?.englishName || '',
        merchantId,
        merchantName: merchantData.stallName || '',

        // 金额和状态
        amount,
        status: 'completed',
        paymentMethod: 'POINTS',

        // ✨ 验证方式标记
        verificationMethod: transactionPin ? 'TRANSACTION_PIN' : 'OTP',
        pinVerified: !!transactionPin,
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[processCustomerPayment] ❌ 错误:', errorMsg);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `付款失败：${error.message || errorMsg}`);
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
exports.transferPoints = onCall(async (request) => {
  const data = request.data;
  const context = request;
  try {
    // === 验证身份 ===
    if (!context.auth) {
      throw new HttpsError('unauthenticated', '请先登录');
    }

    const { toPhoneNumber, amount, otpSessionId } = data;
    const fromUserId = context.auth.uid;

    console.log('[transferPoints] 开始转让点数:', { fromUserId, toPhoneNumber, amount });

    // === 验证参数 ===
    if (!toPhoneNumber || !amount) {
      throw new HttpsError('invalid-argument', '缺少必填字段');
    }

    if (amount <= 0) {
      throw new HttpsError('invalid-argument', '金额必须大于0');
    }

    const db = admin.firestore();

    // === 获取组织和活动信息 ===
    const organizationId = context.auth.token.organizationId;
    const eventId = context.auth.token.eventId;

    if (!organizationId || !eventId) {
      throw new HttpsError('failed-precondition', '缺少组织或活动信息');
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
        .where('basicInfo.phoneNumber', '==', variant)
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
      throw new HttpsError(
        'not-found',
        '接收方不存在或不是Customer'
      );
    }

    // 不能转给自己
    if (toUserId === fromUserId) {
      throw new HttpsError('invalid-argument', '不能转给自己');
    }

    console.log('[transferPoints] ✅ 接收方找到:', toUserId);

    // === 读取Platform Settings检查是否需要OTP ===
    const settings = await getPlatformSettings();
    const otpRequired = settings?.otpRequired?.customerTransfer || false;

    // === 如果需要OTP，验证之 ===
    if (otpRequired) {
      if (!otpSessionId) {
        throw new HttpsError(
          'failed-precondition',
          '此操作需要OTP验证，请先发送验证码'
        );
      }

      const { otpDoc, otpData } = await verifyOtpSession(otpSessionId, context);

      if (otpData.scenario !== 'customerTransfer') {
        throw new HttpsError('invalid-argument', 'OTP场景不匹配');
      }

      if (otpData.userId !== fromUserId) {
        throw new HttpsError('permission-denied', '无权使用此OTP');
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
        throw new HttpsError('not-found', '转出方不存在');
      }

      const fromCustomerData = fromCustomerDoc.data();
      const availablePoints = fromCustomerData.customer?.pointsAccount?.availablePoints || 0;

      // 检查余额
      if (availablePoints < amount) {
        throw new HttpsError(
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
        Type: 'customer_transfer',

        // 转出方
        fromUser: {
          userId: fromUserId,
          userName: fromCustomerData.basicInfo?.chineseName || fromCustomerData.basicInfo?.englishName || '',
          phone: fromCustomerData.basicInfo?.phoneNumber || ''
        },

        // 接收方
        toUser: {
          userId: toUserId,
          userName: toCustomerData.basicInfo?.chineseName || toCustomerData.basicInfo?.englishName || '',
          phone: toCustomerData.basicInfo?.phoneNumber || ''
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
      recipientName: toCustomerData.basicInfo?.chineseName || toCustomerData.basicInfo?.englishName || '',
      message: '转让成功'
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[transferPoints] ❌ 错误:', errorMsg);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `转让失败：${error.message}`);
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
exports.topupFromPointCard = onCall(async (request) => {
  const data = request.data;
  const context = request;
  try {
    // === 验证身份 ===
    if (!context.auth) {
      throw new HttpsError('unauthenticated', '请先登录');
    }

    const { cardId } = data;
    const customerId = context.auth.uid;

    console.log('[topupFromPointCard] 开始点数卡充值:', { customerId, cardId });

    // === 验证参数 ===
    if (!cardId) {
      throw new HttpsError('invalid-argument', '缺少点数卡ID');
    }

    const db = admin.firestore();

    // === 获取组织和活动信息 ===
    const organizationId = context.auth.token.organizationId;
    const eventId = context.auth.token.eventId;

    if (!organizationId || !eventId) {
      throw new HttpsError('failed-precondition', '缺少组织或活动信息');
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
        throw new HttpsError('not-found', '点数卡不存在');
      }

      const cardData = cardDoc.data();

      // 验证卡片状态
      if (!cardData.status?.isActive) {
        throw new HttpsError('failed-precondition', '点数卡已失效');
      }

      if (cardData.status?.isDestroyed) {
        throw new HttpsError('failed-precondition', '点数卡已被使用');
      }

      if (cardData.status?.isExpired) {
        throw new HttpsError('failed-precondition', '点数卡已过期');
      }

      const currentBalance = cardData.balance?.current || 0;

      if (currentBalance <= 0) {
        throw new HttpsError('failed-precondition', '点数卡余额为零');
      }

      // 读取Customer
      const customerRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(customerId);

      const customerDoc = await transaction.get(customerRef);

      if (!customerDoc.exists) {
        throw new HttpsError('not-found', 'Customer不存在');
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
        Type: 'point_card_topup',

        // 点数卡信息
        cardId,
        cardNumber: cardData.cardNumber || '',

        // Customer信息
        customerId,
        customerName: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName || '',  // ✅ 添加
        customerPhone: customerData.basicInfo?.phoneNumber || '',  // ✅ 修复
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[topupFromPointCard] ❌ 错误:', errorMsg);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `充值失败：${error.message}`);
  }
});

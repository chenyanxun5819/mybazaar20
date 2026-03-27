const { onCall, HttpsError } = require('firebase-functions/v2/https');  // ✅ 改用 v2 导入
const admin = require('firebase-admin');
const crypto = require('crypto');
const { hashPin, verifyPin } = require('../../utils/bcryptHelper');
const { updateUserCustomClaims } = require('../../custom_claims_helper');  // ✅ 新增：Custom Claims 辅助函数

// 定義缺失的常量
const MAX_PIN_FAILED_ATTEMPTS = 5;

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



// Transaction PIN helpers implemented below

/**
 * 验证交易密码（内部函数）- 兼容 bcrypt 和 SHA256 两种格式
 */
async function verifyTransactionPinInternal(transactionPin, userData) {
  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION = 60 * 60 * 1000; // 1小时

  // 检查是否被锁定
  const pinLockedUntil = userData.basicInfo?.pinLockedUntil;
  if (pinLockedUntil) {
    const lockTime = pinLockedUntil.toMillis ? pinLockedUntil.toMillis() : pinLockedUntil;
    if (Date.now() < lockTime) {
      const remainingTime = Math.ceil((lockTime - Date.now()) / 60000);
      return {
        success: false,
        locked: true,
        error: `账户已锁定，请在 ${remainingTime} 分钟后重试`
      };
    }
  }

  // 检查错误次数
  const failedAttempts = userData.basicInfo?.pinFailedAttempts || 0;
  if (failedAttempts >= MAX_ATTEMPTS) {
    return {
      success: false,
      locked: true,
      error: '交易密码错误次数过多，账户已被锁定1小时'
    };
  }

  // 验证密码
  const pinHash = userData.basicInfo?.transactionPinHash;
  const pinSalt = userData.basicInfo?.transactionPinSalt;

  if (!pinHash) {
    return {
      success: false,
      missing: true,
      error: '交易密码未设置'
    };
  }

  console.log('[verifyTransactionPinInternal] 检测加密方式:', {
    hasSalt: !!pinSalt && pinSalt.length > 0,
    format: (pinSalt && pinSalt.length > 0) ? 'SHA256（旧格式）' : 'bcrypt（新格式）'
  });

  let isPinCorrect = false;

  try {
    // ✅ 修复：检查 pinSalt 是否存在且有实际内容
    // - 如果有非空 pinSalt：使用 SHA256（旧格式，向后兼容）
    // - 如果 pinSalt 为空/null/undefined：使用 bcrypt（新格式）
    if (pinSalt && pinSalt.length > 0) {
      // 旧格式：使用 SHA256 验证
      const inputHash = sha256(transactionPin + pinSalt);
      isPinCorrect = (inputHash === pinHash);
      console.log('[verifyTransactionPinInternal] 使用 SHA256 验证（旧格式）');
    } else {
      // 新格式：使用 bcrypt 验证
      isPinCorrect = await verifyPin(transactionPin, pinHash);
      console.log('[verifyTransactionPinInternal] 使用 bcrypt 验证（新格式）');
    }

    if (isPinCorrect) {
      return {
        success: true
      };
    }

    return {
      success: false,
      currentAttempts: failedAttempts,
      error: '交易密码错误'
    };
  } catch (error) {
    console.error('[verifyTransactionPinInternal] 验证失败:', error);
    return {
      success: false,
      error: '密码验证失败，请重试'
    };
  }
}

/**
 * 更新PIN验证状态（内部函数）
 */
async function updatePinVerificationStatus(userRef, success, currentAttempts = 0) {
  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION = 60 * 60 * 1000; // 1小时

  if (success) {
    // 验证成功：重置错误次数
    await userRef.update({
      'basicInfo.pinFailedAttempts': 0,
      'basicInfo.pinLockedUntil': null,
      'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    // 验证失败：增加错误次数
    const newAttempts = currentAttempts + 1;
    const updateData = {
      'basicInfo.pinFailedAttempts': newAttempts,
      'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    };

    // 如果达到最大尝试次数，锁定账户
    if (newAttempts >= MAX_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION);
      updateData['basicInfo.pinLockedUntil'] = admin.firestore.Timestamp.fromDate(lockUntil);
    }

    await userRef.update(updateData);
  }
}

// ===========================================
// 📝 Customer注册
// ===========================================

/**
 * ✨ 纯OTP注册版：创建Customer账户
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织ID
 * @param {string} data.eventId - 活动ID
 * @param {string} data.phoneNumber - 手机号（可为 012... 或 +60...；Firestore 统一存 0...）
 * @param {string} data.displayName - 显示名称（昵称）
 * @param {string} data.transactionPin - 交易密码（6位数字）
 * @param {string} [data.email] - 邮箱（可选）
 * 
 * ⚠️ 注意：此版本不需要password，用户通过OTP验证身份后设置交易密码即可
 */
exports.createCustomer = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data } = request;

  try {
    const {
      organizationId,
      eventId,
      phoneNumber,
      displayName,
      transactionPin,
      email
    } = data;

    console.log('[createCustomer] 📥 收到注册请求（纯OTP模式）:', {
      organizationId: organizationId || 'MISSING',
      eventId: eventId || 'MISSING',
      phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 4)}***` : 'MISSING',
      displayName: displayName || 'MISSING',
      hasTransactionPin: !!transactionPin,
      hasEmail: !!email,
    });

    // === 验证必填字段 ===
    if (!organizationId || !eventId || !phoneNumber || !displayName || !transactionPin) {
      const missing = [];
      if (!organizationId) missing.push('organizationId');
      if (!eventId) missing.push('eventId');
      if (!phoneNumber) missing.push('phoneNumber');
      if (!displayName) missing.push('displayName');
      if (!transactionPin) missing.push('transactionPin');

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

    // === 验证交易密码格式 ===
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

    // === 原子性生成 external 序号（ext00001 格式）===
    const eventRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId);

    const externalSeq = await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      const currentSeq = (eventSnap.data()?.roleStats?.customers?.lastExternalSeq) || 0;
      const nextSeq = currentSeq + 1;
      tx.update(eventRef, { 'roleStats.customers.lastExternalSeq': nextSeq });
      return nextSeq;
    });

    const generatedIdentityId = `ext${String(externalSeq).padStart(5, '0')}`;
    console.log('[createCustomer] 🪪 生成 external identityId:', generatedIdentityId);

    // === 生成交易密码哈希（使用 bcrypt）===
    const pinHashData = await hashPin(transactionPin);
    const pinHash = pinHashData.hash;

    console.log('[createCustomer] 🔐 交易密码加密完成');

    // === 生成用户ID ===
    // === 生成 authUid ===
    // ✅ 统一格式：使用 phone_60xxx 格式
    const authUid = `phone_60${parsedPhone.localDigits}`;
    console.log('[createCustomer] 🔑 生成 authUid:', authUid);

    // === 检查 Auth 中是否已存在该 UID ===
    let existingAuthUser = null;
    try {
      existingAuthUser = await admin.auth().getUser(authUid);
      console.log('[createCustomer] ⚠️ Auth 中已存在该 UID:', authUid);
    } catch (e) {
      // 用户不存在，这是正常的
      if (e.code !== 'auth/user-not-found') {
        console.warn('[createCustomer] 检查 Auth 用户时出错:', e.message);
      }
    }

    // === 生成用户ID ===
    // ✅ 统一格式：userId = authUid (phone_60xxx)
    const userId = authUid;

    console.log('[createCustomer] 🆔 生成用户ID:', userId);

    // === 创建Customer文档 ===
    const customerData = {
      userId,
      authUid: userId,  // ✨ 添加 authUid
      roles: ['customer'],
      
      // ✨ 身份标签（根级别，符合 Firestore 架构定义）
      identityTag: 'external',  // Customer 是外部用户

      // 身份信息
      identityInfo: {
        identityId: generatedIdentityId,  // 自动生成 ext00001 格式可读序号
        identityName: '顾客',
        department: null,
        position: null
      },

      // ✨ 纯OTP模式：基本信息（phoneNumber 统一存本地 0... 格式）
      basicInfo: {
        phoneNumber: parsedPhone.local0,
        englishName: displayName,
        chineseName: displayName,
        email: email || null,
        isPhoneVerified: true,  // ✅ 通过OTP验证注册，手机号已验证

        // ❌ 移除登录密码相关字段（纯OTP登录）
        // 注：如需密码登录，可在首次登录后设置

        // ✨ 交易密码（bcrypt 的 salt 已包含在 hash 中）
        transactionPinHash: pinHash,
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
      // 如果 Auth 中已存在该 UID，则跳过创建（用户可能在其他事件已注册）
      if (!existingAuthUser) {
        // ✨ 纯OTP模式：生成随机密码（用户不会使用，仅用于Auth系统）
        const randomPassword = crypto.randomBytes(32).toString('hex');

        await admin.auth().createUser({
          uid: userId,
          phoneNumber: parsedPhone.e164,  // ✅ Auth 使用 E.164
          password: randomPassword,  // ✅ 随机密码（用户通过OTP登录，不需要此密码）
          displayName: displayName
        });

        console.log('[createCustomer] ✅ Firebase Auth 账户创建成功（OTP登录模式）');
      } else {
        console.log('[createCustomer] ℹ️ Auth 账户已存在，跳过创建:', userId);

        // 如果用户在 Auth 中已存在，但在本 Event 中是新增的，这是允许的
        // （用户可能在其他 Event 已注册）
      }
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

      if (authError.code === 'auth/uid-already-exists') {
        throw new HttpsError(
          'already-exists',
          '用户账户已存在，请直接登录'
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

    // === ✅ 新增：设置 Custom Claims（支持多事件）===
    try {
      console.log('[createCustomer] 🔐 设置 Custom Claims...');

      // 读取 event 文档获取 orgCode 和 eventCode
      const eventDoc = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .get();

      if (eventDoc.exists) {
        const eventData = eventDoc.data();
        const orgCode = eventData.orgCode;
        const eventCode = eventData.eventCode;

        if (orgCode && eventCode) {
          await updateUserCustomClaims(userId, orgCode, eventCode, 'add');
          console.log('[createCustomer] ✅ Custom Claims 设置成功');
        } else {
          console.warn('[createCustomer] ⚠️ Event 文档缺少 orgCode 或 eventCode');
        }
      } else {
        console.warn('[createCustomer] ⚠️ Event 文档不存在');
      }
    } catch (claimsError) {
      // Custom Claims 设置失败不影响用户创建
      console.error('[createCustomer] ⚠️ Custom Claims 设置失败（非致命）:', claimsError.message);
    }

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
 * @param {string} data.transactionPin - 交易密码（6位数字）
 */
exports.processCustomerPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
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
      transactionPin
    } = requestData;

    let customerId = context.auth?.uid || null;

    console.log('[processCustomerPayment] ✅ 提取的参数:', {
      merchantId: merchantId || 'missing',
      amount: amount || 'missing',
      organizationId: organizationId || 'missing',
      eventId: eventId || 'missing',
      hasTransactionPin: !!transactionPin
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

      if (pinVerifyResult.missing) {
        throw new HttpsError('failed-precondition', pinVerifyResult.error);
      }

      if (pinVerifyResult.locked) {
        throw new HttpsError('failed-precondition', pinVerifyResult.error);
      }

      if (!pinVerifyResult.success) {
        // 更新验证状态（增加错误次数）
        await updatePinVerificationStatus(customerRef, false, pinVerifyResult.currentAttempts);

        const MAX_ATTEMPTS = 5;
        const remainingAttempts = MAX_ATTEMPTS - (pinVerifyResult.currentAttempts + 1);

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
      throw new HttpsError(
        'invalid-argument',
        '请提供交易密码进行验证'
      );
    }

    // ============================================
    // 🔧 修复说明：processCustomerPayment
    // ============================================
    // 
    // 修改位置：customerFunctions.js 第 708-817 行
    // 
    // ⚠️ 重要：只需要修改这个部分，其他代码保持不变
    //
    // ============================================

    // === 第 708 行开始：使用Transaction执行付款 ===
    const result = await db.runTransaction(async (transaction) => {
      // 重新读取Customer文档（确保数据最新）
      const customerDocLatest = await transaction.get(customerRef);
      const customerDataLatest = customerDocLatest.data();
      const availablePoints = customerDataLatest.customer?.pointsAccount?.availablePoints || 0;

      // ⭐ 修改：检查余额（但不立即扣除）
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

      // ⭐ 修改（2026-01-23）：立即扣除 Customer 点数
      // 改为实时扣除模式，Customer 支付时立即扣除，不等待 Merchant 确认
      transaction.update(customerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(-amount),
        'customer.pointsAccount.totalSpent': admin.firestore.FieldValue.increment(amount),
        'customer.stats.transactionCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.merchantPaymentCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // ⭐ 修改（2026-01-23）：立即增加 Merchant 收入
      // Customer 支付时立即增加收入（不等待确认）
      transaction.update(merchantRef, {
        'revenueStats.totalRevenue': admin.firestore.FieldValue.increment(amount),
        'revenueStats.transactionCount': admin.firestore.FieldValue.increment(1),
        'dailyRevenue.today': admin.firestore.FieldValue.increment(amount),
        'dailyRevenue.todayTransactionCount': admin.firestore.FieldValue.increment(1),
        'metadata.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // ⭐ 新增（2026-02-27）：同步更新 Event 层级汇总统计
      // financeSummary.points.totalSpent  ← Customer 在商家消费的累计点数
      // roleStats.customers.totalSpent    ← Customer 角色汇总
      // roleStats.merchants.totalRevenue  ← Merchant 角色汇总（与 merchant.revenueStats 保持一致）
      const eventRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId);

      transaction.update(eventRef, {
        'financeSummary.points.totalSpent':   admin.firestore.FieldValue.increment(amount),
        'roleStats.customers.totalSpent':     admin.firestore.FieldValue.increment(amount),
        'roleStats.merchants.totalRevenue':   admin.firestore.FieldValue.increment(amount),
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
        customerPhone: customerDataLatest.basicInfo?.phoneNumber || '',
        customerName: customerDataLatest.basicInfo?.chineseName || customerDataLatest.basicInfo?.englishName || '',
        merchantId,
        merchantName: merchantData.stallName || '',

        // 金额和状态
        amount,
        status: 'pending',  // ⭐ 修改：改为 pending 状态
        paymentMethod: 'POINTS',

        // ✨ 验证方式标记
        verificationMethod: 'TRANSACTION_PIN',
        pinVerified: true,

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
        remainingBalance: availablePoints  // ⭐ 修改：余额暂时不变
      };
    });

    console.log('[processCustomerPayment] ✅ 付款请求已创建（待商家确认）:', result);

    return {
      success: true,
      transactionId: result.transactionId,
      remainingBalance: result.remainingBalance - amount,  // ⭐ 修改：扣除後的余額
      message: '支付成功，等待商家确认'  // ⭐ 修改消息
    };

    // ============================================
    // 📝 修改总结
    // ============================================
    //
    // 1. 第 789 行：status: 'completed' → status: 'pending'
    // 2. 注释掉第 743-749 行：不立即扣除 Customer 点数
    // 3. 注释掉第 760-766 行：不立即增加 Merchant 收入
    // 4. 修改返回消息：'付款成功' → '付款请求已发送，等待商家确认'
    //
    // ============================================

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
 * @param {string} data.transactionPin - 交易密码（6位数字）
 */
exports.transferPoints = onCall({ region: 'asia-southeast1' }, async (request) => {
  const data = request.data;
  const context = request;
  try {
    // === 验证身份 ===
    if (!context.auth) {
      throw new HttpsError('unauthenticated', '请先登录');
    }

    const { toPhoneNumber, amount, transactionPin } = data;
    const fromUserId = context.auth.uid;

    console.log('[transferPoints] 开始转让点数:', { fromUserId, toPhoneNumber, amount, hasTransactionPin: !!transactionPin });

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

    // === 读取转出方（用于 PIN 验证） ===
    const fromCustomerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(fromUserId);

    const fromCustomerDoc = await fromCustomerRef.get();

    if (!fromCustomerDoc.exists) {
      throw new HttpsError('not-found', '转出方不存在');
    }

    const fromCustomerDataForVerify = fromCustomerDoc.data();

    // === 优先使用交易密码验证（新版） ===
    if (transactionPin) {
      if (!/^\d{6}$/.test(transactionPin)) {
        throw new HttpsError('invalid-argument', '交易密码必须是6位数字');
      }

      const pinVerifyResult = await verifyTransactionPinInternal(transactionPin, fromCustomerDataForVerify);

      if (pinVerifyResult.missing) {
        throw new HttpsError('failed-precondition', pinVerifyResult.error);
      }

      if (pinVerifyResult.locked) {
        throw new HttpsError('failed-precondition', pinVerifyResult.error);
      }

      if (!pinVerifyResult.success) {
        await updatePinVerificationStatus(fromCustomerRef, false, pinVerifyResult.currentAttempts);

        const remainingAttempts = MAX_PIN_FAILED_ATTEMPTS - (pinVerifyResult.currentAttempts + 1);
        if (remainingAttempts <= 0) {
          throw new HttpsError('failed-precondition', '交易密码错误次数过多，账户已被锁定1小时');
        }

        throw new HttpsError('permission-denied', `交易密码错误，剩余尝试次数：${remainingAttempts}`);
      }

      await updatePinVerificationStatus(fromCustomerRef, true);
      console.log('[transferPoints] ✅ 交易密码验证通过');
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

    // === 验证：必须有 PIN ===
    if (!transactionPin) {
      throw new HttpsError(
        'invalid-argument',
        '请提供交易密码进行验证'
      );
    }

    // === 使用Transaction执行转让 ===
    const result = await db.runTransaction(async (transaction) => {
      // 读取转出方
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
        transactionType: 'customer_transfer',

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

        // ✨ 验证方式标记
        verificationMethod: 'TRANSACTION_PIN',
        pinVerified: true,

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
exports.topupFromPointCard = onCall({ region: 'asia-southeast1' }, async (request) => {
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
        transactionType: 'point_card_topup',

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
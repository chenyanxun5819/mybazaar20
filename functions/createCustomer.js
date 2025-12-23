/**
 * createCustomer.js
 * 创建新的 Customer 用户（注册时调用）
 * 
 * 用于：
 * 1. Customer 自主注册
 * 2. 同时设置登录密码和交易密码
 * 
 * 特点：
 * - isFirstLogin = false（主动注册）
 * - hasDefaultPassword = false（不是默认密码）
 * - 直接设置交易密码
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { hashPassword, hashPin } = require('./utils/bcryptHelper');
const { 
  validateLoginPassword, 
  validateTransactionPin, 
  validatePhoneNumber,
  validateEmail 
} = require('./utils/validators');

exports.createCustomer = onCall(async (request) => {
  const { data } = request;

  try {
    // ========== 1. 提取参数 ==========
    const {
      organizationId,
      eventId,
      phoneNumber,
      displayName,
      password,
      transactionPin,
      email
    } = data;

    console.log('[createCustomer] 收到注册请求:', {
      organizationId,
      eventId,
      phoneNumber,
      displayName,
      hasPassword: !!password,
      hasPin: !!transactionPin,
      hasEmail: !!email
    });

    // ========== 2. 验证必填参数 ==========
    if (!organizationId || !eventId || !phoneNumber || !displayName || !password || !transactionPin) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // ========== 3. 验证参数格式 ==========
    // 验证手机号
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      throw new HttpsError('invalid-argument', phoneValidation.error);
    }

    // 验证登录密码
    const passwordValidation = validateLoginPassword(password);
    if (!passwordValidation.isValid) {
      throw new HttpsError('invalid-argument', passwordValidation.error);
    }

    // 验证交易密码
    const pinValidation = validateTransactionPin(transactionPin);
    if (!pinValidation.isValid) {
      throw new HttpsError('invalid-argument', pinValidation.error);
    }

    // 验证邮箱（如果提供）
    if (email) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) {
        throw new HttpsError('invalid-argument', emailValidation.error);
      }
    }

    // 验证 displayName 长度
    if (displayName.length < 2 || displayName.length > 20) {
      throw new HttpsError('invalid-argument', '昵称长度必须在2-20个字符之间');
    }

    // ========== 4. 检查组织和活动是否存在 ==========
    const db = admin.firestore();
    
    const eventRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId);

    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      throw new HttpsError('not-found', '活动不存在');
    }

    // ========== 5. 检查手机号是否已注册 ==========
    const usersRef = eventRef.collection('users');
    const existingUserQuery = await usersRef
      .where('basicInfo.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (!existingUserQuery.empty) {
      throw new HttpsError('already-exists', '该手机号已注册，请直接登录');
    }

    // ========== 6. 创建 Firebase Auth 用户 ==========
    let authUser;
    try {
      authUser = await admin.auth().createUser({
        phoneNumber: phoneNumber,
        password: password,
        displayName: displayName
      });

      console.log('[createCustomer] Firebase Auth 用户创建成功:', authUser.uid);
    } catch (authError) {
      console.error('[createCustomer] 创建 Auth 用户失败:', authError);
      
      if (authError.code === 'auth/phone-number-already-exists') {
        throw new HttpsError('already-exists', '该手机号已被使用');
      }
      
      throw new HttpsError('internal', '创建用户失败，请重试');
    }

    // ========== 7. 加密密码和 PIN ==========
    const { hash: passwordHash, salt: passwordSalt } = await hashPassword(password);
    const { hash: pinHash, salt: pinSalt } = await hashPin(transactionPin);

    // ========== 8. 创建 Firestore 用户文档 ==========
    const userId = authUser.uid;
    const userRef = usersRef.doc(userId);

    const userData = {
      userId: userId,
      authUid: userId,
      roles: ['customer'],
      identityTag: 'external', // Customer 通常是外部用户
      
      identityInfo: {
        identityTag: 'external',
        identityName: '顾客',
        department: null
      },

      basicInfo: {
        phoneNumber: phoneNumber,
        englishName: displayName,
        chineseName: displayName, // 如果没有中文名，使用 displayName
        email: email || null,
        isPhoneVerified: false,
        
        // 登录密码
        passwordHash: passwordHash,
        passwordSalt: passwordSalt,
        isFirstLogin: false,  // 主动注册的用户，不是首次登录
        hasDefaultPassword: false,  // 不是默认密码
        passwordLastChanged: admin.firestore.FieldValue.serverTimestamp(),
        
        // 交易密码
        transactionPinHash: pinHash,
        transactionPinSalt: pinSalt,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLastChanged: admin.firestore.FieldValue.serverTimestamp()
      },

      customer: {
        pointsAccount: {
          availablePoints: 0,
          reservedPoints: 0,
          totalReceived: 0,
          totalSpent: 0,
          totalTransferredOut: 0,
          totalTransferredIn: 0
        },
        qrCodeData: {
          type: 'CUSTOMER_RECEIVE_POINTS',
          version: '1.0',
          userId: userId,
          eventId: eventId,
          organizationId: organizationId,
          generatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
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

      accountStatus: {
        isActive: true,
        isSuspended: false,
        suspensionReason: null,
        lastLoginAt: null,
        requirePasswordChange: false
      },

      activityData: {
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        totalLogins: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'self-registration'
      }
    };

    await userRef.set(userData);

    console.log('[createCustomer] Firestore 用户文档创建成功:', userId);

    // ========== 9. 更新 Event 的 Customer 统计 ==========
    await eventRef.update({
      'roleStats.customers.total': admin.firestore.FieldValue.increment(1),
      'roleStats.customers.active': admin.firestore.FieldValue.increment(1)
    });

    // ========== 10. 生成 Custom Token（用于登录） ==========
    const customToken = await admin.auth().createCustomToken(userId, {
      organizationId: organizationId,
      eventId: eventId,
      roles: ['customer']
    });

    console.log('[createCustomer] Customer 注册成功:', {
      userId,
      phoneNumber,
      displayName
    });

    // ========== 11. 返回成功 ==========
    return {
      success: true,
      message: '注册成功',
      userId: userId,
      customToken: customToken
    };

  } catch (error) {
    console.error('[createCustomer] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '注册失败，请重试');
  }
});

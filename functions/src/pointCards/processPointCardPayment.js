/**
 * processPointCardPayment.js
 * 处理点数卡付款 - Merchant扫描点数卡并扣款
 * 
 * 功能：
 * 1. 验证Merchant交易密码
 * 2. 验证点数卡状态和余额
 * 3. 扣除点数卡余额
 * 4. 增加Merchant收入统计
 * 5. 创建transaction记录
 * 6. 更新点数卡使用统计
 * 
 * 使用Firestore Transaction确保原子性
 * 
 * 创建日期：2025-01-20
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

exports.processPointCardPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { 
      cardId, 
      merchantId, 
      amount, 
      transactionPin, 
      organizationId, 
      eventId 
    } = data;

    console.log('[processPointCardPayment] 收到付款请求:', {
      cardId,
      merchantId,
      amount,
      organizationId,
      eventId,
      callerUid: auth.uid
    });

    // ========== 3. 验证必填参数 ==========
    if (!cardId || !merchantId || !amount || !transactionPin) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    if (!organizationId || !eventId) {
      throw new HttpsError('invalid-argument', '缺少组织或活动ID');
    }

    // 验证金额
    if (amount <= 0 || !Number.isFinite(amount)) {
      throw new HttpsError('invalid-argument', '金额必须大于0');
    }

    const db = admin.firestore();

    // ========== 4. 获取调用者用户信息 ==========
    const callerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(auth.uid);

    const callerDoc = await callerRef.get();

    if (!callerDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const callerData = callerDoc.data();
    const callerRoles = callerData.roles || [];

    // ========== 5. 验证权限 ==========
    const isMerchantOwner = callerRoles.includes('merchantOwner');
    const isMerchantAsist = callerRoles.includes('merchantAsist');

    if (!isMerchantOwner && !isMerchantAsist) {
      throw new HttpsError('permission-denied', '只有商家摊主或助理可以收款');
    }

    // 以 merchants 文档为准验证商家归属（避免 users.merchantOwner/merchantAsist.merchantId 缺失导致无法收款）
    const merchantRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(merchantId);

    const merchantDocForAuth = await merchantRef.get();
    if (!merchantDocForAuth.exists) {
      throw new HttpsError('not-found', '商家不存在');
    }

    const merchantDataForAuth = merchantDocForAuth.data() || {};
    const isOwnerOfMerchant = merchantDataForAuth.merchantOwnerId === auth.uid;
    const isAsistOfMerchant = Array.isArray(merchantDataForAuth.merchantAsists)
      && merchantDataForAuth.merchantAsists.includes(auth.uid);

    console.log('[processPointCardPayment] 商家归属验证:', {
      merchantId,
      isOwnerOfMerchant,
      isAsistOfMerchant,
      callerRoles
    });

    let collectorRole;
    if (isOwnerOfMerchant && isMerchantOwner) {
      collectorRole = 'merchantOwner';
    } else if (isAsistOfMerchant && isMerchantAsist) {
      collectorRole = 'merchantAsist';
    } else if (isOwnerOfMerchant || isAsistOfMerchant) {
      throw new HttpsError('failed-precondition', '账号角色与商家分配不一致，请管理员检查角色/商家分配');
    } else {
      throw new HttpsError('permission-denied', '只能为自己的商家收款');
    }

    // ========== 6. 验证交易密码 ==========
    console.log('[processPointCardPayment] 验证交易密码...');
    await verifyTransactionPin(auth.uid, transactionPin, organizationId, eventId);

    // ========== 7. 准备文档引用 ==========
    const cardRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('pointCards').doc(cardId);

    const transactionsRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('transactions');

    // ========== 8. 使用事务执行付款 ==========
    const result = await db.runTransaction(async (transaction) => {
      // 8.1 读取点数卡
      const cardDoc = await transaction.get(cardRef);
      if (!cardDoc.exists) {
        throw new HttpsError('not-found', '点数卡不存在');
      }

      const cardData = cardDoc.data();

      // 8.2 验证点数卡状态
      if (!cardData.status?.isActive) {
        throw new HttpsError('failed-precondition', '点数卡已失效');
      }

      if (cardData.status?.isExpired) {
        throw new HttpsError('failed-precondition', '点数卡已过期');
      }

      if (cardData.status?.isDestroyed) {
        throw new HttpsError('failed-precondition', '点数卡已销毁');
      }

      // 8.3 验证余额
      const currentBalance = cardData.balance?.current || 0;
      if (currentBalance < amount) {
        throw new HttpsError(
          'failed-precondition',
          `点数卡余额不足（余额：${currentBalance}，需要：${amount}）`
        );
      }

      // 8.4 读取商家信息
      const merchantDoc = await transaction.get(merchantRef);
      if (!merchantDoc.exists) {
        throw new HttpsError('not-found', '商家不存在');
      }

      const merchantData = merchantDoc.data();

      // 8.5 扣除点数卡余额
      const newBalance = currentBalance - amount;
      const newSpent = (cardData.balance?.spent || 0) + amount;
      const isEmpty = newBalance === 0;

      transaction.update(cardRef, {
        'balance.current': newBalance,
        'balance.spent': newSpent,
        'status.isEmpty': isEmpty,
        'status.lastUsedAt': admin.firestore.FieldValue.serverTimestamp(),
        'usageStats.transactionCount': admin.firestore.FieldValue.increment(1),
        'usageStats.lastUsedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 添加商家到使用列表
      const merchantsUsed = cardData.usageStats?.merchantsUsed || [];
      if (!merchantsUsed.includes(merchantId)) {
        transaction.update(cardRef, {
          'usageStats.merchantsUsed': admin.firestore.FieldValue.arrayUnion(merchantId)
        });
      }

      // 如果是首次使用，记录首次使用时间
      if (!cardData.usageStats?.firstUsedAt) {
        transaction.update(cardRef, {
          'usageStats.firstUsedAt': admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // 8.6 更新商家收入统计
      const newTotalRevenue = (merchantData.revenueStats?.totalRevenue || 0) + amount;
      const newTransactionCount = (merchantData.revenueStats?.transactionCount || 0) + 1;
      const newTodayRevenue = (merchantData.dailyRevenue?.today || 0) + amount;
      const newTodayTransactionCount = (merchantData.dailyRevenue?.todayTransactionCount || 0) + 1;

      // 根据收款人角色更新分类收入
      let ownerUpdate = {};
      let asistUpdate = {};

      if (collectorRole === 'merchantOwner') {
        const newOwnerRevenue = (merchantData.revenueStats?.ownerCollectedRevenue || 0) + amount;
        const newTodayOwnerCollected = (merchantData.dailyRevenue?.todayOwnerCollected || 0) + amount;
        ownerUpdate = {
          'revenueStats.ownerCollectedRevenue': newOwnerRevenue,
          'dailyRevenue.todayOwnerCollected': newTodayOwnerCollected
        };
      } else if (collectorRole === 'merchantAsist') {
        const newAsistsRevenue = (merchantData.revenueStats?.asistsCollectedRevenue || 0) + amount;
        const newTodayAsistsCollected = (merchantData.dailyRevenue?.todayAsistsCollected || 0) + amount;
        asistUpdate = {
          'revenueStats.asistsCollectedRevenue': newAsistsRevenue,
          'dailyRevenue.todayAsistsCollected': newTodayAsistsCollected
        };
      }

      transaction.update(merchantRef, {
        'revenueStats.totalRevenue': newTotalRevenue,
        'revenueStats.transactionCount': newTransactionCount,
        'dailyRevenue.today': newTodayRevenue,
        'dailyRevenue.todayTransactionCount': newTodayTransactionCount,
        ...ownerUpdate,
        ...asistUpdate,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 8.7 更新收款人统计
      if (collectorRole === 'merchantOwner') {
        // 更新摊主的统计数据
        const newOwnerTotal = (callerData.merchantOwner?.statistics?.totalCollected || 0) + amount;
        const newOwnerCount = (callerData.merchantOwner?.statistics?.transactionCount || 0) + 1;

        transaction.update(callerRef, {
          'merchantOwner.statistics.totalCollected': newOwnerTotal,
          'merchantOwner.statistics.transactionCount': newOwnerCount,
          'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
      } else if (collectorRole === 'merchantAsist') {
        // 更新助理的统计数据
        const newPersonalTotal = (callerData.merchantAsist?.statistics?.totalCollected || 0) + amount;
        const newPersonalCount = (callerData.merchantAsist?.statistics?.transactionCount || 0) + 1;
        const newPersonalToday = (callerData.merchantAsist?.statistics?.todayCollected || 0) + amount;
        const newPersonalTodayCount = (callerData.merchantAsist?.statistics?.todayTransactionCount || 0) + 1;

        transaction.update(callerRef, {
          'merchantAsist.statistics.totalCollected': newPersonalTotal,
          'merchantAsist.statistics.transactionCount': newPersonalCount,
          'merchantAsist.statistics.todayCollected': newPersonalToday,
          'merchantAsist.statistics.todayTransactionCount': newPersonalTodayCount,
          'merchantAsist.statistics.lastCollectionAt': admin.firestore.FieldValue.serverTimestamp(),
          'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // 8.8 创建交易记录
      const newTransactionRef = transactionsRef.doc();
      const now = new Date();

      transaction.set(newTransactionRef, {
        // 基本信息
        transactionId: newTransactionRef.id,
        transactionType: 'point_card_payment', // 点数卡付款
        
        // 点数卡信息
        pointCardId: cardId,
        pointCardNumber: cardData.cardNumber,
        
        // 商家信息
        merchantId: merchantId,
        merchantName: merchantData.stallName || '未知商家',
        
        // 收款人信息
        collectedBy: auth.uid,
        collectorRole: collectorRole,
        collectorName: callerData.basicInfo?.chineseName || callerData.basicInfo?.englishName || '未知',
        
        // 金额信息
        amount: amount,
        
        // 状态信息
        status: 'completed',
        
        // 时间信息
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        
        // 验证信息
        pinVerified: true,
        pinVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        verificationMethod: 'transaction_pin',
        
        // 状态历史
        statusHistory: [{
          status: 'completed',
          timestamp: now,
          updatedBy: auth.uid,
          updaterRole: collectorRole,
          note: '点数卡付款完成'
        }],
        
        // 元数据
        metadata: {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: auth.uid,
          eventId: eventId,
          organizationId: organizationId,
          source: 'point_card_scanner'
        }
      });

      console.log('[processPointCardPayment] 交易完成:', {
        transactionId: newTransactionRef.id,
        amount,
        remainingBalance: newBalance
      });

      return {
        transactionId: newTransactionRef.id,
        remainingBalance: newBalance
      };
    });

    // ========== 9. 返回成功 ==========
    return {
      success: true,
      message: '付款成功',
      transactionId: result.transactionId,
      amount: amount,
      remainingBalance: result.remainingBalance,
      collectorRole: collectorRole
    };

  } catch (error) {
    console.error('[processPointCardPayment] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '处理付款失败，请重试');
  }
});

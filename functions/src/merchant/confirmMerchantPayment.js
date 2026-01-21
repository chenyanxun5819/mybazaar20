/**
 * confirmMerchantPayment.js
 * 确认收款 - merchantOwner 或 merchantAsist 确认待收的交易
 * 
 * ⭐ 修复版本（2026-01-17）
 * 修复内容：
 * 1. 修正 Customer 数据结构路径：customer.pointsAccount.availablePoints
 * 2. 修正交易字段名称：transactionType（不是 type）
 * 3. 添加 Customer 统计更新
 * 4. 添加访问过的商家列表
 * 
 * 功能：
 * 1. 验证交易状态为 pending
 * 2. 验证调用者权限（merchantOwner 或 merchantAsist）
 * 3. 扣除 customer 点数
 * 4. 增加 merchant 收入统计
 * 5. 更新交易状态为 completed
 * 6. 记录收款人信息（collectedBy, collectorRole）
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.confirmMerchantPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { organizationId, eventId, transactionId } = data;

    console.log('[confirmMerchantPayment] 收到确认请求:', {
      organizationId,
      eventId,
      transactionId,
      callerUid: auth.uid
    });

    // ========== 3. 验证必填参数 ==========
    if (!organizationId || !eventId || !transactionId) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    const db = admin.firestore();

    // ========== 4. 获取交易文档 ==========
    const transactionRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('transactions').doc(transactionId);

    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', '交易不存在');
    }

    const transactionData = transactionDoc.data();

    // ========== 5. 验证交易状态 ==========
    if (transactionData.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `交易状态为 ${transactionData.status}，无法确认`
      );
    }

    // ========== 6. 验证交易类型 ==========
    // ⭐ 修复：改为 transactionType（匹配 processCustomerPayment）
    if (transactionData.transactionType !== 'customer_to_merchant') {
      throw new HttpsError('invalid-argument', '交易类型错误');
    }

    // ========== 7. 获取调用者用户信息 ==========
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

    // ========== 8. 验证权限 ==========
    const isMerchantOwner = callerRoles.includes('merchantOwner');
    const isMerchantAsist = callerRoles.includes('merchantAsist');

    if (!isMerchantOwner && !isMerchantAsist) {
      throw new HttpsError('permission-denied', '只有商家摊主或助理可以确认收款');
    }

    // 以 merchants 文档为准验证商家归属（避免 users.merchantOwner/merchantAsist.merchantId 缺失导致无法确认）
    const merchantRefForAuth = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(transactionData.merchantId);

    const merchantDocForAuth = await merchantRefForAuth.get();
    if (!merchantDocForAuth.exists) {
      throw new HttpsError('not-found', '商家不存在');
    }

    const merchantDataForAuth = merchantDocForAuth.data() || {};
    const isOwnerOfMerchant = merchantDataForAuth.merchantOwnerId === auth.uid;
    const isAsistOfMerchant = Array.isArray(merchantDataForAuth.merchantAsists)
      && merchantDataForAuth.merchantAsists.includes(auth.uid);

    console.log('[confirmMerchantPayment] 商家归属验证:', {
      merchantId: transactionData.merchantId,
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
      throw new HttpsError('permission-denied', '此交易不属于您的商家');
    }

    // ========== 9. 获取 Customer 和 Merchant 文档 ==========
    const customerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(transactionData.customerId);

    const merchantRef = merchantRefForAuth;

    const [customerDoc, merchantDoc] = await Promise.all([
      customerRef.get(),
      merchantRef.get()
    ]);

    if (!customerDoc.exists) {
      throw new HttpsError('not-found', '顾客不存在');
    }

    if (!merchantDoc.exists) {
      throw new HttpsError('not-found', '商家不存在');
    }

    const customerData = customerDoc.data();
    const merchantData = merchantDoc.data();

    // ========== 10. 验证 Customer 余额 ==========
    // ⭐ 修复：改为 customer.pointsAccount.availablePoints
    const customerBalance = customerData.customer?.pointsAccount?.availablePoints || 0;
    const amount = transactionData.amount;

    if (customerBalance < amount) {
      throw new HttpsError(
        'failed-precondition',
        `顾客余额不足（余额：${customerBalance}，需要：${amount}）`
      );
    }

    // ========== 11. 使用事务执行操作 ==========
    await db.runTransaction(async (transaction) => {
      // 11.1 扣除 Customer 点数
      const newCustomerBalance = customerBalance - amount;
      // ⭐ 修复：改为 customer.pointsAccount.totalSpent
      const newCustomerTotalSpent = (customerData.customer?.pointsAccount?.totalSpent || 0) + amount;

      // ⭐ 修复：更新正确的字段路径，并添加统计
      transaction.update(customerRef, {
        'customer.pointsAccount.availablePoints': newCustomerBalance,
        'customer.pointsAccount.totalSpent': newCustomerTotalSpent,
        'customer.stats.transactionCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.merchantPaymentCount': admin.firestore.FieldValue.increment(1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // ⭐ 新增：添加到访问过的商家列表
      const merchantsVisited = customerData.customer?.stats?.merchantsVisited || [];
      if (!merchantsVisited.includes(transactionData.merchantId)) {
        transaction.update(customerRef, {
          'customer.stats.merchantsVisited': admin.firestore.FieldValue.arrayUnion(transactionData.merchantId)
        });
      }

      // 11.2 增加 Merchant 收入
      const newTotalRevenue = (merchantData.revenueStats?.totalRevenue || 0) + amount;
      const newTransactionCount = (merchantData.revenueStats?.transactionCount || 0) + 1;
      const newTodayRevenue = (merchantData.dailyRevenue?.today || 0) + amount;
      const newTodayTransactionCount = (merchantData.dailyRevenue?.todayTransactionCount || 0) + 1;

      // 11.3 根据收款人角色更新分类收入
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

      // 11.4 更新交易状态
      // 先生成当前时间
      const now = new Date();

      transaction.update(transactionRef, {
        status: 'completed',
        collectedBy: auth.uid,
        collectorRole: collectorRole,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status: 'completed',
          timestamp: now,  // ✅ 使用普通 Date 对象
          updatedBy: auth.uid,
          updaterRole: collectorRole,
          note: '收款确认'
        })
      });

      // 11.5 更新收款人统计（merchantAsist）
      if (collectorRole === 'merchantAsist') {
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
    });

    console.log('[confirmMerchantPayment] 确认成功:', {
      transactionId,
      amount,
      collectorRole,
      collectorUid: auth.uid
    });

    // ========== 12. 返回成功 ==========
    return {
      success: true,
      message: '收款确认成功',
      transactionId,
      amount,
      collectorRole,
      newCustomerBalance: customerBalance - amount
    };

  } catch (error) {
    console.error('[confirmMerchantPayment] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '确认收款失败，请重试');
  }
});
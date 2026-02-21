/**
 * confirmMerchantPayment.js
 * 确认收款 - merchantOwner 或 merchantAsist 确认待收的交易
 * 
 * ⭐ 最新修复版本（2026-02-19 v2）
 * 修复内容：
 * 1. ✅ 修正重复扣款问题（processCustomerPayment 已扣款，confirm 不再扣款）
 * 2. ✅ 修正重复增加收入问题（processCustomerPayment 已增加，confirm 不再增加）
 * 3. ✅ confirm 只更新交易状态和收款人信息
 * 4. ✅ 修正 Firestore Transaction 顺序（先读取，后写入）
 * 
 * ⚠️ 重要说明：
 * 系统采用"立即扣除模式"（2026-01-23 修改）：
 * - processCustomerPayment: 立即扣除 Customer 点数，立即增加 Merchant 收入
 * - confirmMerchantPayment: 只更新状态，不再扣款和增加收入
 * - cancelMerchantPayment: 回滚点数和收入
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

    // 以 merchants 文档为准验证商家归属
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

    const amount = transactionData.amount;

    console.log('[confirmMerchantPayment] ⭐ 准备确认收款（立即扣除模式）:', {
      transactionId,
      amount,
      collectorRole,
      note: '已在 processCustomerPayment 中扣除，此处只更新状态'
    });

    // ========== 9. 使用事务执行操作 ==========
    const now = new Date();

    await db.runTransaction(async (transaction) => {
      
      // ⭐⭐⭐ 关键修复：所有读取操作必须在写入操作之前
      
      // ========================================
      // 第一步：执行所有读取操作
      // ========================================
      
      // 读取 Merchant 数据
      const merchantRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('merchants').doc(transactionData.merchantId);

      const merchantDoc = await transaction.get(merchantRef);
      
      if (!merchantDoc.exists) {
        throw new HttpsError('not-found', 'Merchant 不存在');
      }
      
      const merchantData = merchantDoc.data() || {};

      console.log('[confirmMerchantPayment] ✅ 已读取 Merchant 数据');

      // 读取 Customer 数据
      const customerRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(transactionData.customerId);

      const customerDoc = await transaction.get(customerRef);
      const customerData = customerDoc.exists ? customerDoc.data() : null;

      console.log('[confirmMerchantPayment] ✅ 已读取 Customer 数据');

      // ========================================
      // 第二步：执行所有写入操作
      // ========================================
      
      console.log('[confirmMerchantPayment] ✅ 跳过扣款和增加收入（已在 processCustomerPayment 中完成）');

      // 9.1 更新交易状态
      transaction.update(transactionRef, {
        status: 'completed',
        collectedBy: auth.uid,
        collectorRole: collectorRole,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status: 'completed',
          timestamp: now,
          updatedBy: auth.uid,
          updaterRole: collectorRole,
          note: '收款确认'
        })
      });

      console.log('[confirmMerchantPayment] ✅ 交易状态已更新为 completed');

      // 9.2 更新收款人个人统计（merchantAsist）
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

        console.log('[confirmMerchantPayment] ✅ 已更新收款人个人统计:', {
          asistId: auth.uid,
          amount,
          newTotal: newPersonalTotal
        });
      }

      // 9.3 更新 Merchant 的收款人分类（记录是谁收的款）
      if (collectorRole === 'merchantOwner') {
        const newOwnerRevenue = (merchantData.revenueStats?.ownerCollectedRevenue || 0) + amount;
        const newTodayOwnerCollected = (merchantData.dailyRevenue?.todayOwnerCollected || 0) + amount;
        
        transaction.update(merchantRef, {
          'revenueStats.ownerCollectedRevenue': newOwnerRevenue,
          'dailyRevenue.todayOwnerCollected': newTodayOwnerCollected,
          'metadata.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[confirmMerchantPayment] ✅ 已更新 merchantOwner 收款分类');
      } else if (collectorRole === 'merchantAsist') {
        const newAsistsRevenue = (merchantData.revenueStats?.asistsCollectedRevenue || 0) + amount;
        const newTodayAsistsCollected = (merchantData.dailyRevenue?.todayAsistsCollected || 0) + amount;
        
        transaction.update(merchantRef, {
          'revenueStats.asistsCollectedRevenue': newAsistsRevenue,
          'dailyRevenue.todayAsistsCollected': newTodayAsistsCollected,
          'metadata.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[confirmMerchantPayment] ✅ 已更新 merchantAsist 收款分类');
      }

      // 9.4 更新 Customer 访问过的商家列表
      if (customerData) {
        const merchantsVisited = customerData.customer?.stats?.merchantsVisited || [];
        
        if (!merchantsVisited.includes(transactionData.merchantId)) {
          transaction.update(customerRef, {
            'customer.stats.merchantsVisited': admin.firestore.FieldValue.arrayUnion(transactionData.merchantId),
            'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
          });

          console.log('[confirmMerchantPayment] ✅ 已添加到访问过的商家列表');
        }
      }
    });

    console.log('[confirmMerchantPayment] ✅ 确认成功:', {
      transactionId,
      amount,
      collectorRole,
      collectorUid: auth.uid
    });

    // ========== 10. 返回成功 ==========
    return {
      success: true,
      message: '收款确认成功',
      transactionId,
      amount,
      collectorRole,
      note: '已在扫码时扣款，确认时不重复扣款'
    };

  } catch (error) {
    console.error('[confirmMerchantPayment] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '确认收款失败，请重试');
  }
});

// ============================================
// 关键修复说明
// ============================================
/*
问题：Firestore Transaction 规则违反
- 错误：先执行 transaction.update()，后执行 transaction.get()
- 规则：所有读取必须在所有写入之前

修复：
1. ✅ 在 transaction 开始时立即读取 merchantDoc 和 customerDoc
2. ✅ 然后执行所有 transaction.update() 操作
3. ✅ 确保顺序：先读取，后写入

正确的顺序：
- 第一步：transaction.get(merchantRef) ← 读取
- 第二步：transaction.get(customerRef) ← 读取
- 第三步：transaction.update(transactionRef) ← 写入
- 第四步：transaction.update(callerRef) ← 写入
- 第五步：transaction.update(merchantRef) ← 写入
- 第六步：transaction.update(customerRef) ← 写入
*/
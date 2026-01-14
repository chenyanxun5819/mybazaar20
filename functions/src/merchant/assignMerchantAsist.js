/**
 * assignMerchantAsist.js
 * 分派商家助理 - merchantManager 为 merchantOwner 分派 merchantAsist
 * 
 * 功能：
 * 1. 验证调用者是 merchantManager
 * 2. 验证目标用户有 merchantAsist 角色
 * 3. 验证商家未满 5 个助理
 * 4. 验证用户未被分派到其他商家
 * 5. 更新 merchant.merchantAsists 数组
 * 6. 更新用户的 merchantAsist 对象
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// 最大助理数量
const MAX_ASISTS_PER_MERCHANT = 5;

exports.assignMerchantAsist = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { organizationId, eventId, merchantId, asistUserId } = data;

    console.log('[assignMerchantAsist] 收到分派请求:', {
      organizationId,
      eventId,
      merchantId,
      asistUserId,
      callerUid: auth.uid
    });

    // ========== 3. 验证必填参数 ==========
    if (!organizationId || !eventId || !merchantId || !asistUserId) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
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

    // ========== 5. 验证权限（仅 merchantManager 可以分派）==========
    const isMerchantManager = callerRoles.includes('merchantManager');

    if (!isMerchantManager) {
      throw new HttpsError('permission-denied', '只有 Merchant Manager 可以分派助理');
    }

    // ========== 6. 获取目标用户文档 ==========
    const asistRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(asistUserId);

    const asistDoc = await asistRef.get();

    if (!asistDoc.exists) {
      throw new HttpsError('not-found', '目标用户不存在');
    }

    const asistData = asistDoc.data();
    const asistRoles = asistData.roles || [];

    // ========== 7. 验证目标用户有 merchantAsist 角色 ==========
    if (!asistRoles.includes('merchantAsist')) {
      throw new HttpsError(
        'failed-precondition',
        '目标用户没有 merchantAsist 角色，请先由 Event Manager 授予角色'
      );
    }

    // ========== 8. 验证用户未被分派到其他商家 ==========
    const currentMerchantId = asistData.merchantAsist?.merchantId;

    if (currentMerchantId && currentMerchantId !== merchantId) {
      throw new HttpsError(
        'failed-precondition',
        '该用户已被分派到其他商家，请先解除现有分派'
      );
    }

    // 如果已经分派到同一个商家，直接返回
    if (currentMerchantId === merchantId) {
      return {
        success: true,
        message: '该用户已是此商家的助理',
        merchantId,
        asistUserId
      };
    }

    // ========== 9. 获取商家文档 ==========
    const merchantRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(merchantId);

    const merchantDoc = await merchantRef.get();

    if (!merchantDoc.exists) {
      throw new HttpsError('not-found', '商家不存在');
    }

    const merchantData = merchantDoc.data();
    const merchantAsists = merchantData.merchantAsists || [];
    const merchantAsistsCount = merchantData.merchantAsistsCount || 0;

    // ========== 10. 验证商家未满 5 个助理 ==========
    if (merchantAsistsCount >= MAX_ASISTS_PER_MERCHANT) {
      throw new HttpsError(
        'failed-precondition',
        `商家助理已达上限（${MAX_ASISTS_PER_MERCHANT}人）`
      );
    }

    // ========== 11. 使用事务执行操作 ==========
    await db.runTransaction(async (transaction) => {
      // 11.1 更新 merchant 文档
      const newMerchantAsists = [...merchantAsists, asistUserId];
      const newMerchantAsistsCount = merchantAsistsCount + 1;

      transaction.update(merchantRef, {
        merchantAsists: newMerchantAsists,
        merchantAsistsCount: newMerchantAsistsCount,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 11.2 更新用户的 merchantAsist 对象
      transaction.update(asistRef, {
        'merchantAsist.merchantId': merchantId,
        'merchantAsist.merchantOwnerId': merchantData.merchantOwnerId,
        'merchantAsist.stallName': merchantData.stallName,
        'merchantAsist.assignmentInfo.assignedAt': admin.firestore.FieldValue.serverTimestamp(),
        'merchantAsist.assignmentInfo.assignedBy': auth.uid,
        'merchantAsist.assignmentInfo.isActive': true,
        'merchantAsist.permissions.canCollectPayments': true,
        'merchantAsist.permissions.canViewOwnTransactions': true,
        'merchantAsist.permissions.canCancelPending': true,
        'merchantAsist.permissions.cannotViewAllTransactions': true,
        'merchantAsist.permissions.cannotEditProfile': true,
        'merchantAsist.permissions.cannotRefund': true,
        'merchantAsist.statistics.totalCollected': 0,
        'merchantAsist.statistics.transactionCount': 0,
        'merchantAsist.statistics.lastCollectionAt': null,
        'merchantAsist.statistics.todayCollected': 0,
        'merchantAsist.statistics.todayTransactionCount': 0,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 11.3 更新 merchantManager 统计（可选）
      // 这里可以增加 merchantManager 的分派计数等统计数据
    });

    console.log('[assignMerchantAsist] 分派成功:', {
      merchantId,
      asistUserId,
      assignedBy: auth.uid
    });

    // ========== 12. 返回成功 ==========
    return {
      success: true,
      message: '助理分派成功',
      merchantId,
      asistUserId,
      stallName: merchantData.stallName
    };

  } catch (error) {
    console.error('[assignMerchantAsist] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '分派助理失败，请重试');
  }
});

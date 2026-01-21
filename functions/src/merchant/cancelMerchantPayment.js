/**
 * cancelMerchantPayment.js
 * 取消交易 - merchantOwner 或 merchantAsist 取消待收的交易
 * 
 * ⭐ 修复版本（2026-01-17）
 * 修复内容：
 * 1. 修正交易字段名称：transactionType（不是 type）
 * 2. 修正 statusHistory 时间戳：使用 Date 对象
 * 
 * 功能：
 * 1. 验证交易状态为 pending
 * 2. 验证调用者权限（merchantOwner 或 merchantAsist）
 * 3. 更新交易状态为 cancelled
 * 4. 记录取消人信息
 * 
 * 注意：Customer 不能自己取消交易（防止欺诈）
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.cancelMerchantPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { organizationId, eventId, transactionId, cancelReason } = data;

    console.log('[cancelMerchantPayment] 收到取消请求:', {
      organizationId,
      eventId,
      transactionId,
      callerUid: auth.uid,
      hasCancelReason: !!cancelReason
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
        `交易状态为 ${transactionData.status}，无法取消`
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

    // ========== 8. 验证权限（只有 merchantOwner 或 merchantAsist 可以取消）==========
    const isMerchantOwner = callerRoles.includes('merchantOwner');
    const isMerchantAsist = callerRoles.includes('merchantAsist');

    if (!isMerchantOwner && !isMerchantAsist) {
      throw new HttpsError('permission-denied', '只有商家摊主或助理可以取消交易');
    }

    // 获取调用者的 merchantId
    let callerMerchantId;
    let cancellerRole;

    if (isMerchantOwner) {
      callerMerchantId = callerData.merchantOwner?.merchantId;
      cancellerRole = 'merchantOwner';
    } else if (isMerchantAsist) {
      callerMerchantId = callerData.merchantAsist?.merchantId;
      cancellerRole = 'merchantAsist';
    }

    if (!callerMerchantId) {
      throw new HttpsError('failed-precondition', '用户未关联到商家');
    }

    // 验证交易是否属于该商家
    if (transactionData.merchantId !== callerMerchantId) {
      throw new HttpsError('permission-denied', '此交易不属于您的商家');
    }

    // ========== 9. 更新交易状态 ==========
    // ⭐ 修复：statusHistory 中不能使用 FieldValue.serverTimestamp()
    const now = new Date();
    
    await transactionRef.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: auth.uid,
      cancellerRole: cancellerRole,
      cancelReason: cancelReason || '商家取消',
      statusHistory: admin.firestore.FieldValue.arrayUnion({
        status: 'cancelled',
        timestamp: now,  // ✅ 使用 Date 对象
        updatedBy: auth.uid,
        updaterRole: cancellerRole,
        note: cancelReason || '商家取消'
      })
    });

    console.log('[cancelMerchantPayment] 取消成功:', {
      transactionId,
      cancellerRole,
      cancellerUid: auth.uid
    });

    // ========== 10. 返回成功 ==========
    return {
      success: true,
      message: '交易已取消',
      transactionId,
      cancelledBy: auth.uid,
      cancellerRole
    };

  } catch (error) {
    console.error('[cancelMerchantPayment] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '取消交易失败，请重试');
  }
});
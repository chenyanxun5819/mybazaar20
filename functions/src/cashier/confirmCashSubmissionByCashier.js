/**
 * confirmCashSubmissionByCashier.js
 * Cashier 确认 PointSeller/Seller/SellerManager 的现金上交
 * 
 * 功能：
 * 1. 验证 Cashier 交易密码
 * 2. 验证 cashSubmission 存在且状态为 pending
 * 3. 更新 cashSubmission 状态为 confirmed
 * 4. 更新提交者的统计数据（totalSubmitted）
 * 5. 更新 Cashier 的统计数据
 * 6. 创建审计记录
 * 
 * 使用 Firestore Transaction 确保原子性
 * 
 * 创建日期：2025-01-20
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// 导入共用的交易密码验证函数
const { verifyTransactionPin } = require('../utils/verifyTransactionPin');

exports.confirmCashSubmissionByCashier = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { 
      submissionId,
      receiptNumber,
      confirmationNote,
      transactionPin,
      organizationId,
      eventId
    } = data;

    console.log('[confirmCashSubmissionByCashier] 收到确认请求:', {
      submissionId,
      organizationId,
      eventId,
      cashierUid: auth.uid
    });

    // ========== 3. 验证必填参数 ==========
    if (!submissionId || !transactionPin) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    if (!organizationId || !eventId) {
      throw new HttpsError('invalid-argument', '缺少组织或活动ID');
    }

    const db = admin.firestore();

    // ========== 4. 获取 Cashier 用户信息 ==========
    const cashierRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(auth.uid);

    const cashierDoc = await cashierRef.get();

    if (!cashierDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const cashierData = cashierDoc.data();
    const cashierRoles = cashierData.roles || [];

    // ========== 5. 验证权限 ==========
    if (!cashierRoles.includes('cashier')) {
      throw new HttpsError('permission-denied', '只有 Cashier 可以确认现金上交');
    }

    // ========== 6. 验证交易密码 ==========
    console.log('[confirmCashSubmissionByCashier] 验证交易密码...');
    await verifyTransactionPin(auth.uid, transactionPin, organizationId, eventId);

    // ========== 7. 准备文档引用 ==========
    const submissionRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('cashSubmissions').doc(submissionId);

    // ========== 8. 使用事务执行确认 ==========
    const result = await db.runTransaction(async (transaction) => {
      // 8.1 读取 cashSubmission
      const submissionDoc = await transaction.get(submissionRef);
      
      if (!submissionDoc.exists) {
        throw new HttpsError('not-found', '现金上交记录不存在');
      }

      const submissionData = submissionDoc.data();

      // 8.2 验证状态
      if (submissionData.status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          `此记录已${submissionData.status === 'confirmed' ? '确认' : '处理'}，无法重复确认`
        );
      }

      // 8.3 验证提交者存在
      const submitterRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(submissionData.submittedBy);

      const submitterDoc = await transaction.get(submitterRef);

      if (!submitterDoc.exists) {
        throw new HttpsError('not-found', '提交者不存在');
      }

      const submitterData = submitterDoc.data();
      const submitterRole = submissionData.submitterRole;

      // 8.4 更新 cashSubmission 状态
      const now = admin.firestore.FieldValue.serverTimestamp();
      
      transaction.update(submissionRef, {
        status: 'confirmed',
        confirmedAt: now,
        receivedBy: auth.uid,
        receiverName: cashierData.basicInfo?.chineseName || cashierData.basicInfo?.englishName || 'Cashier',
        receiverRole: 'cashier',
        receiptNumber: receiptNumber || null,
        confirmationNote: confirmationNote || '',
        'metadata.updatedAt': now
      });

      // 8.5 更新提交者的统计数据
      const amount = submissionData.amount || 0;

      if (submitterRole === 'pointSeller') {
        // PointSeller 统计更新
        transaction.update(submitterRef, {
          'pointSeller.statistics.totalSubmitted': admin.firestore.FieldValue.increment(amount),
          'pointSeller.statistics.submissionCount': admin.firestore.FieldValue.increment(1),
          'pointSeller.statistics.lastSubmissionAt': now,
          'pointSeller.statistics.lastConfirmedAt': now,
          'activityData.updatedAt': now
        });

      } else if (submitterRole === 'seller') {
        // Seller 统计更新
        transaction.update(submitterRef, {
          'seller.statistics.totalSubmitted': admin.firestore.FieldValue.increment(amount),
          'seller.statistics.submissionCount': admin.firestore.FieldValue.increment(1),
          'seller.statistics.lastSubmissionAt': now,
          'activityData.updatedAt': now
        });

      } else if (submitterRole === 'sellerManager') {
        // SellerManager 统计更新
        transaction.update(submitterRef, {
          'sellerManager.statistics.totalSubmitted': admin.firestore.FieldValue.increment(amount),
          'sellerManager.statistics.submissionCount': admin.firestore.FieldValue.increment(1),
          'sellerManager.statistics.lastSubmissionAt': now,
          'activityData.updatedAt': now
        });
      }

      // 8.6 更新 Cashier 统计
      transaction.update(cashierRef, {
        'cashier.statistics.totalReceived': admin.firestore.FieldValue.increment(amount),
        'cashier.statistics.confirmationCount': admin.firestore.FieldValue.increment(1),
        'cashier.statistics.todayReceived': admin.firestore.FieldValue.increment(amount),
        'cashier.statistics.todayConfirmationCount': admin.firestore.FieldValue.increment(1),
        'cashier.statistics.lastConfirmationAt': now,
        'activityData.updatedAt': now
      });

      console.log('[confirmCashSubmissionByCashier] 确认完成:', {
        submissionId,
        amount,
        submitterRole
      });

      return {
        submissionId,
        amount,
        submitterName: submissionData.submitterName,
        confirmedAt: new Date()
      };
    });

    // ========== 9. 返回成功 ==========
    return {
      success: true,
      message: '现金上交确认成功',
      submissionId: result.submissionId,
      amount: result.amount,
      submitterName: result.submitterName,
      confirmedAt: result.confirmedAt
    };

  } catch (error) {
    console.error('[confirmCashSubmissionByCashier] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '确认现金上交失败，请重试');
  }
});

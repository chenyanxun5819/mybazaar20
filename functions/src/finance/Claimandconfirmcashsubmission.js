/**
 * Cloud Function: claimAndConfirmCashSubmission
 * 接单并确认现金收款（待认领池子模式）
 * 
 * 功能：
 * 1. 验证交易密码
 * 2. 使用 Transaction 防止重复确认
 * 3. 更新 cashSubmissions 状态
 * 4. 更新 FinanceManager 统计
 * 5. 更新 Event 统计
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

exports.claimAndConfirmCashSubmission = onCall({ region: 'asia-southeast1' }, async (request) => {
    // ===== 1. 身份验证 =====
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        '需要登录才能执行此操作'
      );
    }

    const { orgId, eventId, submissionId, transactionPin, confirmationNote } = request.data;

    // 参数验证
    if (!orgId || !eventId || !submissionId) {
      throw new HttpsError(
        'invalid-argument',
        '缺少必要参数：orgId, eventId, submissionId'
      );
    }

    if (!transactionPin || transactionPin.length !== 6) {
      throw new HttpsError(
        'invalid-argument',
        '交易密码必须是6位数字'
      );
    }

    // ===== 2. 验证 Finance Manager 权限 =====
    const fmUserId = request.auth.uid;
    const userRef = admin.firestore()
      .doc(`organizations/${orgId}/events/${eventId}/users/${fmUserId}`);

    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError(
        'not-found',
        '用户不存在'
      );
    }

    const userData = userDoc.data();
    const roles = userData.roles || [];

    if (!roles.includes('financeManager')) {
      throw new HttpsError(
        'permission-denied',
        '只有 Finance Manager 可以确认收款'
      );
    }

    // ===== 3. 验证交易密码 =====
    await verifyTransactionPin(financeManagerId, transactionPin, orgId, eventId);

    // ===== 4. 使用 Transaction 确认收款（防止重复） =====
    const db = admin.firestore();
    const submissionRef = db.doc(
      `organizations/${orgId}/events/${eventId}/cashSubmissions/${submissionId}`
    );

    let confirmedAmount = 0;
    let submitterRole = '';

    try {
      await db.runTransaction(async (transaction) => {
        // 读取 submission
        const submissionDoc = await transaction.get(submissionRef);

        if (!submissionDoc.exists) {
          throw new Error('收款记录不存在');
        }

        const submission = submissionDoc.data();

        // 检查状态
        if (submission.status !== 'pending') {
          throw new Error('此笔收款已处理，无法重复确认');
        }

        // 检查是否已被认领
        if (submission.receivedBy !== null) {
          throw new Error('此笔收款正在被其他 Finance Manager 处理中');
        }

        confirmedAmount = submission.amount || 0;
        submitterRole = submission.submitterRole || '';

        // 更新 submission 状态
        transaction.update(submissionRef, {
          receivedBy: fmUserId,
          receiverName: userData.basicInfo?.chineseName || userData.basicInfo?.englishName || 'Finance Manager',
          receiverChineseName: userData.basicInfo?.chineseName || '',
          receiverEnglishName: userData.basicInfo?.englishName || '',
          status: 'confirmed',
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmationNote: confirmationNote || '',
          metadata: {
            ...submission.metadata,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            confirmedBy: fmUserId
          }
        });

        // 更新 FinanceManager 统计
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // todayTimestamp not used; removed to satisfy lint

        transaction.update(userRef, {
          'financeManager.cashStats.totalCollected': admin.firestore.FieldValue.increment(confirmedAmount),
          'financeManager.cashStats.todayCollected': admin.firestore.FieldValue.increment(confirmedAmount),
          'financeManager.cashStats.totalCollections': admin.firestore.FieldValue.increment(1),
          'financeManager.cashStats.todayCollections': admin.firestore.FieldValue.increment(1),
          'financeManager.cashStats.lastCollectionAt': admin.firestore.FieldValue.serverTimestamp()
        });

        // 更新 Event 统计
        const eventRef = db.doc(`organizations/${orgId}/events/${eventId}`);
        
        transaction.update(eventRef, {
          'financeSummary.cash.totalCollected': admin.firestore.FieldValue.increment(confirmedAmount),
          'financeSummary.cash.totalPending': admin.firestore.FieldValue.increment(-confirmedAmount),
          'financeSummary.lastUpdatedAt': admin.firestore.FieldValue.serverTimestamp(),
          'financeSummary.lastUpdatedBy': fmUserId
        });

        // 更新收款分布
        const collectionKey = `financeSummary.collectionsByFinanceManager.${fmUserId}`;
        transaction.update(eventRef, {
          [`${collectionKey}.managerName`]: userData.basicInfo?.chineseName || userData.basicInfo?.englishName || 'Finance Manager',
          [`${collectionKey}.totalCollected`]: admin.firestore.FieldValue.increment(confirmedAmount),
          [`${collectionKey}.collectionsCount`]: admin.firestore.FieldValue.increment(1),
          [`${collectionKey}.lastCollection`]: admin.firestore.FieldValue.serverTimestamp()
        });

        // 根据提交者角色更新现金来源统计
        if (submitterRole) {
          const sourceKey = `financeSummary.cash.sourcesByRole.${submitterRole}`;
          transaction.update(eventRef, {
            [`${sourceKey}.totalAmount`]: admin.firestore.FieldValue.increment(confirmedAmount),
            [`${sourceKey}.totalSubmissions`]: admin.firestore.FieldValue.increment(1),
            [`${sourceKey}.lastSubmission`]: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      // ===== 5. 返回成功 =====
      return {
        success: true,
        message: '收款确认成功',
        data: {
          submissionId,
          amount: confirmedAmount,
          confirmedBy: fmUserId,
          confirmedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Transaction failed:', error);
      throw new HttpsError(
        'internal',
        error.message || '确认收款失败，请重试'
      );
    }
  });
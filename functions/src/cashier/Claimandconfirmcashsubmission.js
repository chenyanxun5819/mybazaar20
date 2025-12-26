/**
 * Cloud Function: claimAndConfirmCashSubmission
 * 接单并确认现金收款（待认领池子模式）
 * 
 * 功能：
 * 1. 验证交易密码
 * 2. 使用 Transaction 防止重复确认
 * 3. 更新 cashSubmissions 状态
 * 4. 更新 Cashier 统计
 * 5. 更新 Event 统计
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');

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

    // ===== 2. 验证 Cashier 权限 =====
    const cashierId = request.auth.uid;
    const userRef = admin.firestore()
      .doc(`organizations/${orgId}/events/${eventId}/users/${cashierId}`);

    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError(
        'not-found',
        '用户不存在'
      );
    }

    const userData = userDoc.data();
    const roles = userData.roles || [];

    if (!roles.includes('cashier')) {
      throw new HttpsError(
        'permission-denied',
        '只有 Cashier 可以确认收款'
      );
    }

    // ===== 3. 验证交易密码 =====
    // 改用 basicInfo.* 存取交易密碼與錯誤/鎖定欄位，以與其他函式一致
    const basicInfo = userData.basicInfo || {};
    const storedPinHash = basicInfo.transactionPinHash;

    if (!storedPinHash) {
      throw new HttpsError(
        'failed-precondition',
        '您还未设置交易密码，请先设置交易密码'
      );
    }

    const isPinValid = await bcrypt.compare(transactionPin, storedPinHash);

    if (!isPinValid) {
      // 记录失败次数
      const failedAttempts = (basicInfo.pinFailedAttempts || 0) + 1;
      const lockUntil = basicInfo.pinLockedUntil;

      // 检查是否已锁定
      if (lockUntil && lockUntil.toDate() > new Date()) {
        const remainingMinutes = Math.ceil((lockUntil.toDate() - new Date()) / 60000);
        throw new HttpsError(
          'permission-denied',
          `账号已锁定，请${remainingMinutes}分钟后再试`
        );
      }

      // 更新失败次数
      await userRef.update({
        'basicInfo.pinFailedAttempts': failedAttempts,
        'basicInfo.lastPinFailedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 5次失败后锁定1小时
      if (failedAttempts >= 5) {
        const lockUntilTime = new Date(Date.now() + 60 * 60 * 1000);
        await userRef.update({
          'basicInfo.pinLockedUntil': admin.firestore.Timestamp.fromDate(lockUntilTime),
          'basicInfo.pinFailedAttempts': 0
        });
        throw new HttpsError(
          'permission-denied',
          '交易密码错误次数过多，账号已锁定1小时'
        );
      }

      throw new HttpsError(
        'permission-denied',
        `交易密码错误，还剩 ${5 - failedAttempts} 次机会`
      );
    }

    // 密码正确，重置失败次数
    await userRef.update({
      'basicInfo.pinFailedAttempts': 0,
      'basicInfo.lastPinSuccessAt': admin.firestore.FieldValue.serverTimestamp()
    });

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
          throw new Error('此笔收款正在被其他 Cashier 处理中');
        }

        confirmedAmount = submission.amount || 0;
        submitterRole = submission.submitterRole || '';

        // 更新 submission 状态
        transaction.update(submissionRef, {
          receivedBy: cashierId,
          receiverName: userData.basicInfo?.chineseName || userData.basicInfo?.englishName || 'Cashier',
          receiverChineseName: userData.basicInfo?.chineseName || '',
          receiverEnglishName: userData.basicInfo?.englishName || '',
          status: 'confirmed',
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
          confirmationNote: confirmationNote || '',
          metadata: {
            ...submission.metadata,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            confirmedBy: cashierId
          }
        });

        // 更新 Cashier 统计
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

        transaction.update(userRef, {
          'cashier.cashStats.totalCollected': admin.firestore.FieldValue.increment(confirmedAmount),
          'cashier.cashStats.todayCollected': admin.firestore.FieldValue.increment(confirmedAmount),
          'cashier.cashStats.totalCollections': admin.firestore.FieldValue.increment(1),
          'cashier.cashStats.todayCollections': admin.firestore.FieldValue.increment(1),
          'cashier.cashStats.lastCollectionAt': admin.firestore.FieldValue.serverTimestamp()
        });

        // 更新 Event 统计
        const eventRef = db.doc(`organizations/${orgId}/events/${eventId}`);
        
        transaction.update(eventRef, {
          'financeSummary.cash.totalCollected': admin.firestore.FieldValue.increment(confirmedAmount),
          'financeSummary.cash.totalPending': admin.firestore.FieldValue.increment(-confirmedAmount),
          'financeSummary.lastUpdatedAt': admin.firestore.FieldValue.serverTimestamp(),
          'financeSummary.lastUpdatedBy': cashierId
        });

        // 更新收款分布
        const collectionKey = `financeSummary.collectionsByCashier.${cashierId}`;
        transaction.update(eventRef, {
          [`${collectionKey}.managerName`]: userData.basicInfo?.chineseName || userData.basicInfo?.englishName || 'Cashier',
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
          confirmedBy: cashierId,
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